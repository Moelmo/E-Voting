import { db } from '../db/index.js';
import { broadcastUpdate } from '../utils/socket.js';
import { logAudit } from '../utils/audit.js';

export function getPublicSettings(req, res) {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settingsMap = {};
    for (const r of rows) {
      if (r.key !== 'spoiler_password_hash') {
        settingsMap[r.key] = r.value;
      }
    }

    const logos = db.prepare('SELECT id, file_url, is_primary, position FROM logos ORDER BY position ASC, id ASC').all();

    return res.json({
      success: true,
      data: {
        settings: settingsMap,
        logos
      }
    });
  } catch (err) {
    console.error('Error getPublicSettings:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan publik' });
  }
}

export function getActiveCandidates(req, res) {
  try {
    const candidates = db.prepare(`
      SELECT id, number, title, description, photo_url, sort_order
      FROM candidates
      WHERE is_active = 1
      ORDER BY number ASC, sort_order ASC
    `).all();

    const membersStmt = db.prepare('SELECT id, name, position FROM candidate_members WHERE candidate_id = ? ORDER BY id ASC');

    const result = candidates.map(c => {
      const members = membersStmt.all(c.id);
      return {
        ...c,
        members
      };
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('Error getActiveCandidates:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat kandidat aktif' });
  }
}

export function castVote(req, res) {
  try {
    const studentId = req.student.id;
    const { candidateId } = req.body;

    if (!candidateId) {
      return res.status(400).json({ success: false, message: 'Kandidat yang dipilih wajib disertakan' });
    }

    // Pastikan voting masih buka
    const votingSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('voting_open');
    if (!votingSetting || votingSetting.value !== '1') {
      return res.status(403).json({ success: false, message: 'Voting saat ini telah DITUTUP' });
    }

    // Validasi kandidat aktif
    const candidate = db.prepare('SELECT id, number FROM candidates WHERE id = ? AND is_active = 1').get(candidateId);
    if (!candidate) {
      return res.status(404).json({ success: false, message: 'Kandidat yang dipilih tidak ditemukan atau sudah dinonaktifkan' });
    }

    // Eksekusi transaksi atomik (tanpa menyimpan student_id di tabel votes demi kerahasiaan suara)
    db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      // 1. Cek status has_voted siswa saat ini
      const checkStudent = db.prepare('SELECT has_voted, name, nis FROM students WHERE id = ?').get(studentId);
      if (!checkStudent) {
        db.exec('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan' });
      }

      if (checkStudent.has_voted) {
        db.exec('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Anda sudah pernah menggunakan hak suara. Pemilihan ganda dilarang!' });
      }

      // 2. Insert suara anonim
      db.prepare('INSERT INTO votes (candidate_id, created_at) VALUES (?, CURRENT_TIMESTAMP)').run(candidate.id);

      // 3. Update status siswa
      const updateRes = db.prepare('UPDATE students SET has_voted = 1, voted_at = CURRENT_TIMESTAMP WHERE id = ? AND has_voted = 0').run(studentId);

      if (updateRes.changes === 0) {
        db.exec('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Gagal mencatat suara, hak suara sudah terpakai' });
      }

      db.exec('COMMIT');

      // Broadcast update realtime ke admin via Socket.io
      const stats = db.prepare(`
        SELECT 
          (SELECT COUNT(*) FROM students) AS total_students,
          (SELECT COUNT(*) FROM students WHERE has_voted = 1) AS voted_students
      `).get();

      broadcastUpdate('vote_updated', {
        total: stats.total_students,
        voted: stats.voted_students,
        percent: stats.total_students > 0 ? Math.round((stats.voted_students / stats.total_students) * 100) : 0,
        timestamp: new Date().toISOString()
      });

      return res.json({
        success: true,
        message: 'Suara Anda telah berhasil dicatat. Terima kasih!'
      });
    } catch (txErr) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      console.error('Transaction error in castVote:', txErr);
      return res.status(500).json({ success: false, message: 'Gagal memproses transaksi voting' });
    }
  } catch (err) {
    console.error('Error castVote:', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem saat memilih' });
  }
}
