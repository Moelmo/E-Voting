import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { generateToken } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';

export async function loginAdmin(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
    }

    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    const token = generateToken({ id: admin.id, username: admin.username, role: 'admin' }, '8h');
    logAudit(admin.username, 'LOGIN', 'Admin login berhasil', req.ip);

    return res.json({
      success: true,
      message: 'Login admin berhasil',
      data: {
        token,
        admin: { id: admin.id, username: admin.username }
      }
    });
  } catch (err) {
    console.error('Error loginAdmin:', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
}

export async function loginStudent(req, res) {
  try {
    const { nis } = req.body;
    if (!nis) {
      return res.status(400).json({ success: false, message: 'NIS wajib diisi atau discan' });
    }

    const cleanNis = String(nis).trim();

    // Cek apakah voting sedang dibuka
    const votingSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('voting_open');
    if (!votingSetting || votingSetting.value !== '1') {
      return res.status(403).json({ success: false, message: 'Voting saat ini sedang DITUTUP oleh administrator' });
    }

    const student = db.prepare('SELECT * FROM students WHERE nis = ?').get(cleanNis);
    if (!student) {
      return res.status(404).json({ success: false, message: 'NIS tidak ditemukan dalam daftar pemilih tetap' });
    }

    if (student.has_voted) {
      return res.status(400).json({
        success: false,
        message: `Siswa atas nama ${student.name} (NIS: ${student.nis}) sudah menggunakan hak suara pada ${student.voted_at || 'waktu sebelumnya'}.`
      });
    }

    // Token siswa berumur singkat (15 menit)
    const token = generateToken({ id: student.id, nis: student.nis, name: student.name, role: 'student' }, '15m');

    return res.json({
      success: true,
      message: 'Autentikasi siswa berhasil',
      data: {
        token,
        student: {
          id: student.id,
          name: student.name,
          nis: student.nis,
          class: student.class
        }
      }
    });
  } catch (err) {
    console.error('Error loginStudent:', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
}
