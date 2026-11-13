import bcrypt from 'bcryptjs';
import xlsx from 'xlsx';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { db } from '../db/index.js';
import { logAudit } from '../utils/audit.js';
import { broadcastUpdate } from '../utils/socket.js';

// --- SPOILER VERIFICATION ---
export async function verifySpoiler(req, res) {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password spoiler wajib diisi' });
    }

    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('spoiler_password_hash');
    if (!row) {
      return res.status(500).json({ success: false, message: 'Pengaturan password spoiler belum diset' });
    }

    const match = await bcrypt.compare(password, row.value);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Password spoiler salah!' });
    }

    return res.json({ success: true, message: 'Password spoiler terverifikasi' });
  } catch (err) {
    console.error('Error verifySpoiler:', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada verifikasi spoiler' });
  }
}

// --- OVERVIEW (REALTIME) ---
export function getOverview(req, res) {
  try {
    const stats = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM students) AS total,
        (SELECT COUNT(*) FROM students WHERE has_voted = 1) AS voted
    `).get();

    const total = stats.total || 0;
    const voted = stats.voted || 0;
    const remaining = total - voted;
    const percent = total > 0 ? Math.round((voted / total) * 100) : 0;

    // Ambil log aktivitas voting siswa terbaru (maksimal 25 data)
    const recentVoters = db.prepare(`
      SELECT id, name, nis, class, voted_at
      FROM students
      WHERE has_voted = 1
      ORDER BY voted_at DESC
      LIMIT 25
    `).all();

    return res.json({
      success: true,
      data: {
        total,
        voted,
        remaining,
        percent,
        recentVoters,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error getOverview:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil ringkasan partisipasi' });
  }
}

// --- REKAP SUARA (SPOILER) ---
export function getRecap(req, res) {
  try {
    const activeCandidates = db.prepare(`
      SELECT id, number, title, photo_url
      FROM candidates
      WHERE is_active = 1
      ORDER BY number ASC
    `).all();

    const membersStmt = db.prepare('SELECT name, position FROM candidate_members WHERE candidate_id = ?');
    const totalVotes = db.prepare('SELECT COUNT(*) as count FROM votes').get().count || 0;

    const candidateResults = activeCandidates.map(c => {
      const voteCount = db.prepare('SELECT COUNT(*) as count FROM votes WHERE candidate_id = ?').get(c.id).count || 0;
      const members = membersStmt.all(c.id);
      const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100 * 10) / 10 : 0;
      return {
        ...c,
        members,
        votes: voteCount,
        percentage
      };
    });

    // Daftar siswa yang sudah voting (TANPA PILIHAN KANDIDAT untuk menjamin kerahasiaan suara)
    const { page = 1, limit = 20, q = '', classFilter = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT id, name, nis, class, voted_at FROM students WHERE has_voted = 1';
    const params = [];

    if (q) {
      query += ' AND (name LIKE ? OR nis LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    if (classFilter) {
      query += ' AND class = ?';
      params.push(classFilter);
    }

    const countQuery = query.replace('SELECT id, name, nis, class, voted_at', 'SELECT COUNT(*) as count');
    const totalItems = db.prepare(countQuery).get(...params).count;

    query += ' ORDER BY voted_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const votedStudents = db.prepare(query).all(...params);

    return res.json({
      success: true,
      data: {
        totalVotes,
        candidates: candidateResults,
        voters: {
          items: votedStudents,
          total: totalItems,
          page: Number(page),
          totalPages: Math.ceil(totalItems / limit) || 1
        }
      }
    });
  } catch (err) {
    console.error('Error getRecap:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil rekapitulasi suara' });
  }
}

// --- DATA SISWA CRUD & QR ---
export function getStudents(req, res) {
  try {
    const { page = 1, limit = 20, q = '', classFilter = '', statusFilter = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT id, name, nis, class, has_voted, voted_at, created_at FROM students WHERE 1=1';
    const params = [];

    if (q) {
      query += ' AND (name LIKE ? OR nis LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    if (classFilter) {
      query += ' AND class = ?';
      params.push(classFilter);
    }

    if (statusFilter === 'voted') {
      query += ' AND has_voted = 1';
    } else if (statusFilter === 'not_voted') {
      query += ' AND has_voted = 0';
    }

    const countQuery = query.replace('SELECT id, name, nis, class, has_voted, voted_at, created_at', 'SELECT COUNT(*) as count');
    const totalItems = db.prepare(countQuery).get(...params).count;

    query += ' ORDER BY nis ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const students = db.prepare(query).all(...params);

    // Ambil daftar kelas unik untuk dropdown filter
    const classes = db.prepare("SELECT DISTINCT class FROM students WHERE class IS NOT NULL AND class != '' ORDER BY class ASC").all().map(r => r.class);

    return res.json({
      success: true,
      data: {
        students,
        total: totalItems,
        page: Number(page),
        totalPages: Math.ceil(totalItems / limit) || 1,
        classes
      }
    });
  } catch (err) {
    console.error('Error getStudents:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat data siswa' });
  }
}

export function createStudent(req, res) {
  try {
    const { name, nis, class: className } = req.body;
    if (!name || !nis) {
      return res.status(400).json({ success: false, message: 'Nama dan NIS wajib diisi' });
    }

    const cleanNis = String(nis).trim();
    const existing = db.prepare('SELECT id FROM students WHERE nis = ?').get(cleanNis);
    if (existing) {
      return res.status(400).json({ success: false, message: `NIS ${cleanNis} sudah terdaftar` });
    }

    const result = db.prepare('INSERT INTO students (name, nis, class) VALUES (?, ?, ?)').run(name.trim(), cleanNis, className ? className.trim() : null);
    logAudit(req.admin.username, 'CREATE_STUDENT', `Menambah siswa: ${name} (${cleanNis})`, req.ip);

    return res.status(201).json({
      success: true,
      message: 'Siswa berhasil ditambahkan',
      data: { id: result.lastInsertRowid, name, nis: cleanNis, class: className }
    });
  } catch (err) {
    console.error('Error createStudent:', err);
    return res.status(500).json({ success: false, message: 'Gagal menambahkan siswa' });
  }
}

export function updateStudent(req, res) {
  try {
    const { id } = req.params;
    const { name, nis, class: className } = req.body;

    if (!name || !nis) {
      return res.status(400).json({ success: false, message: 'Nama dan NIS wajib diisi' });
    }

    const cleanNis = String(nis).trim();
    const duplicate = db.prepare('SELECT id FROM students WHERE nis = ? AND id != ?').get(cleanNis, id);
    if (duplicate) {
      return res.status(400).json({ success: false, message: `NIS ${cleanNis} sudah digunakan oleh siswa lain` });
    }

    const result = db.prepare('UPDATE students SET name = ?, nis = ?, class = ? WHERE id = ?').run(name.trim(), cleanNis, className ? className.trim() : null, id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan' });
    }

    logAudit(req.admin.username, 'UPDATE_STUDENT', `Update siswa id ${id}: ${name} (${cleanNis})`, req.ip);
    return res.json({ success: true, message: 'Data siswa berhasil diperbarui' });
  } catch (err) {
    console.error('Error updateStudent:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui data siswa' });
  }
}

export function deleteStudent(req, res) {
  try {
    const { id } = req.params;
    const student = db.prepare('SELECT name, nis FROM students WHERE id = ?').get(id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    db.prepare('DELETE FROM students WHERE id = ?').run(id);
    logAudit(req.admin.username, 'DELETE_STUDENT', `Hapus siswa: ${student.name} (${student.nis})`, req.ip);

    return res.json({ success: true, message: 'Siswa berhasil dihapus' });
  } catch (err) {
    console.error('Error deleteStudent:', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus siswa' });
  }
}

export function bulkDeleteStudents(req, res) {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Daftar ID siswa wajib disertakan' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`DELETE FROM students WHERE id IN (${placeholders})`);
    const result = stmt.run(...ids);

    logAudit(req.admin.username, 'BULK_DELETE_STUDENT', `Menghapus ${result.changes} siswa sekaligus`, req.ip);
    return res.json({ success: true, message: `Berhasil menghapus ${result.changes} siswa` });
  } catch (err) {
    console.error('Error bulkDeleteStudents:', err);
    return res.status(500).json({ success: false, message: 'Gagal melakukan penghapusan massal' });
  }
}

// Unduh Template Impor
export function getStudentTemplate(req, res) {
  const format = req.query.format || 'xlsx';
  const sampleData = [
    { nama: 'Taufiq Iman Putra', nis: '24011835', kelas: 'XII MIPA 1' },
    { nama: 'Siti Nurhaliza', nis: '24011836', kelas: 'XII MIPA 2' },
    { nama: 'Budi Santoso', nis: '24011837', kelas: 'XII IPS 1' }
  ];

  if (format === 'csv') {
    const csv = Papa.unparse(sampleData);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="template_siswa.csv"');
    return res.send(csv);
  } else {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(sampleData);
    xlsx.utils.book_append_sheet(wb, ws, 'Template Siswa');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_siswa.xlsx"');
    return res.send(buffer);
  }
}

// Pratinjau Impor Siswa
export function previewImportStudents(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File CSV atau Excel wajib diunggah' });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let rows = [];

    if (ext === '.csv') {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
      rows = parsed.data;
    } else {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    }

    // Bersihkan file sementara
    try { fs.unlinkSync(filePath); } catch (_) {}

    const previewList = [];
    const errors = [];
    const seenNis = new Set();
    const existingNisMap = new Map();

    const allDbStudents = db.prepare('SELECT nis, name FROM students').all();
    for (const s of allDbStudents) {
      existingNisMap.set(String(s.nis).trim(), s.name);
    }

    rows.forEach((row, index) => {
      const rowNum = index + 2;
      // Normalisasi header (nama, NAMA, name, nis, NIS, kelas, Kelas, class)
      const name = String(row.nama || row.Nama || row.NAMA || row.name || '').trim();
      const nis = String(row.nis || row.NIS || row.Nis || '').trim();
      const className = String(row.kelas || row.Kelas || row.KELAS || row.class || '').trim();

      const rowErrors = [];
      if (!name) rowErrors.push('Nama kosong');
      if (!nis) rowErrors.push('NIS kosong');
      if (nis && !/^[a-zA-Z0-9_-]+$/.test(nis)) rowErrors.push('Format NIS tidak valid');

      if (nis) {
        if (seenNis.has(nis)) {
          rowErrors.push('Duplikat NIS di dalam file');
        } else {
          seenNis.add(nis);
        }
      }

      const existsInDb = existingNisMap.has(nis);

      const item = {
        rowNum,
        name,
        nis,
        class: className,
        existsInDb,
        existingName: existsInDb ? existingNisMap.get(nis) : null,
        errors: rowErrors,
        isValid: rowErrors.length === 0
      };

      if (rowErrors.length > 0) {
        errors.push({ rowNum, nis, name, reasons: rowErrors.join(', ') });
      }

      previewList.push(item);
    });

    return res.json({
      success: true,
      data: {
        totalRows: previewList.length,
        validCount: previewList.filter(p => p.isValid).length,
        errorCount: errors.length,
        duplicateInDbCount: previewList.filter(p => p.existsInDb).length,
        preview: previewList.slice(0, 50), // 50 baris pertama
        allRows: previewList,
        errors
      }
    });
  } catch (err) {
    console.error('Error previewImportStudents:', err);
    return res.status(500).json({ success: false, message: 'Gagal memproses file impor: ' + err.message });
  }
}

// Eksekusi Simpan Impor
export function executeImportStudents(req, res) {
  try {
    const { rows, mode = 'skip' } = req.body;
    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ success: false, message: 'Data baris impor tidak valid' });
    }

    let successCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    const failedRows = [];

    db.exec('BEGIN TRANSACTION');
    try {
      const checkStmt = db.prepare('SELECT id FROM students WHERE nis = ?');
      const insertStmt = db.prepare('INSERT INTO students (name, nis, class) VALUES (?, ?, ?)');
      const updateStmt = db.prepare('UPDATE students SET name = ?, class = ? WHERE nis = ?');

      for (const r of rows) {
        if (!r.isValid) {
          failedCount++;
          failedRows.push({ ...r, reason: r.errors?.join(', ') || 'Baris tidak valid' });
          continue;
        }

        const existing = checkStmt.get(r.nis);
        if (existing) {
          if (mode === 'update') {
            updateStmt.run(r.name, r.class || null, r.nis);
            updatedCount++;
          } else {
            skippedCount++;
          }
        } else {
          insertStmt.run(r.name, r.nis, r.class || null);
          successCount++;
        }
      }

      db.exec('COMMIT');

      logAudit(
        req.admin.username,
        'IMPORT_STUDENTS',
        `Impor selesai. Baru: ${successCount}, Diperbarui: ${updatedCount}, Dilewati: ${skippedCount}, Gagal: ${failedCount}`,
        req.ip
      );

      return res.json({
        success: true,
        message: 'Impor data siswa selesai diproses',
        data: {
          successCount,
          updatedCount,
          skippedCount,
          failedCount,
          failedRows
        }
      });
    } catch (txErr) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw txErr;
    }
  } catch (err) {
    console.error('Error executeImportStudents:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengeksekusi impor data siswa' });
  }
}

// Ekspor Siswa
export function exportStudents(req, res) {
  try {
    const { format = 'xlsx', classFilter = '', statusFilter = '', q = '' } = req.query;

    let query = 'SELECT name, nis, class, has_voted, voted_at FROM students WHERE 1=1';
    const params = [];

    if (q) {
      query += ' AND (name LIKE ? OR nis LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    if (classFilter) {
      query += ' AND class = ?';
      params.push(classFilter);
    }

    if (statusFilter === 'voted') {
      query += ' AND has_voted = 1';
    } else if (statusFilter === 'not_voted') {
      query += ' AND has_voted = 0';
    }

    query += ' ORDER BY nis ASC';
    const students = db.prepare(query).all(...params);

    const exportData = students.map((s, idx) => ({
      'No': idx + 1,
      'Nama Siswa': s.name,
      'NIS': s.nis,
      'Kelas': s.class || '-',
      'Status Memilih': s.has_voted ? 'Sudah' : 'Belum',
      'Waktu Memilih': s.voted_at ? s.voted_at : '-'
    }));

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `data-siswa-${dateStr}`;

    if (format === 'csv') {
      const csv = Papa.unparse(exportData);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    } else {
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.json_to_sheet(exportData);
      xlsx.utils.book_append_sheet(wb, ws, 'Data Siswa');
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(buffer);
    }
  } catch (err) {
    console.error('Error exportStudents:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengekspor data siswa' });
  }
}

// Generate Kartu Pemilih QR Massal
export async function getStudentQRCards(req, res) {
  try {
    const { classFilter = '', statusFilter = '', ids = '' } = req.query;

    let query = 'SELECT id, name, nis, class FROM students WHERE 1=1';
    const params = [];

    if (ids) {
      const idArr = ids.split(',').map(Number).filter(Boolean);
      if (idArr.length > 0) {
        query += ` AND id IN (${idArr.map(() => '?').join(',')})`;
        params.push(...idArr);
      }
    } else {
      if (classFilter) {
        query += ' AND class = ?';
        params.push(classFilter);
      }
      if (statusFilter === 'not_voted') {
        query += ' AND has_voted = 0';
      }
    }

    query += ' ORDER BY class ASC, nis ASC';
    const students = db.prepare(query).all(...params);

    // Dapatkan logo inti
    const primaryLogo = db.prepare('SELECT file_url FROM logos WHERE is_primary = 1 LIMIT 1').get();
    const siteNameRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('site_name');
    const siteName = siteNameRow ? siteNameRow.value : 'E-Voting OSIS';

    // Generate QR Data URLs
    const cards = await Promise.all(students.map(async s => {
      const qrDataUrl = await QRCode.toDataURL(s.nis, {
        margin: 1,
        width: 180,
        color: { dark: '#000000', light: '#ffffff' }
      });

      return {
        id: s.id,
        name: s.name,
        nis: s.nis,
        class: s.class,
        qrDataUrl
      };
    }));

    return res.json({
      success: true,
      data: {
        siteName,
        logo: primaryLogo ? primaryLogo.file_url : null,
        cards
      }
    });
  } catch (err) {
    console.error('Error getStudentQRCards:', err);
    return res.status(500).json({ success: false, message: 'Gagal men-generate kartu QR' });
  }
}

// --- DATA KANDIDAT CRUD ---
export function getCandidates(req, res) {
  try {
    const candidates = db.prepare(`
      SELECT id, number, title, description, photo_url, is_active, sort_order, created_at
      FROM candidates
      ORDER BY number ASC
    `).all();

    const membersStmt = db.prepare('SELECT id, name, position FROM candidate_members WHERE candidate_id = ? ORDER BY id ASC');

    const result = candidates.map(c => {
      const members = membersStmt.all(c.id);
      const voteCount = db.prepare('SELECT COUNT(*) as count FROM votes WHERE candidate_id = ?').get(c.id).count || 0;
      return {
        ...c,
        members,
        voteCount
      };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('Error getCandidates:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat kandidat' });
  }
}

export function createCandidate(req, res) {
  try {
    const { number, title, description, photo_url, is_active = 1, members } = req.body;

    if (!number || !title) {
      return res.status(400).json({ success: false, message: 'Nomor urut dan judul visi-misi wajib diisi' });
    }

    if (!members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ success: false, message: 'Kandidat harus memiliki minimal satu anggota/nama' });
    }

    // Cek duplikasi nomor urut di kandidat yang aktif
    const numInt = parseInt(number, 10);
    const existingNum = db.prepare('SELECT id FROM candidates WHERE number = ?').get(numInt);
    if (existingNum) {
      return res.status(400).json({ success: false, message: `Nomor urut ${numInt} sudah digunakan oleh kandidat lain!` });
    }

    db.exec('BEGIN TRANSACTION');
    try {
      const candidateStmt = db.prepare(`
        INSERT INTO candidates (number, title, description, photo_url, is_active, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const cRes = candidateStmt.run(numInt, title.trim(), description || '', photo_url || '', is_active ? 1 : 0, numInt);
      const candidateId = cRes.lastInsertRowid;

      const memberStmt = db.prepare('INSERT INTO candidate_members (candidate_id, name, position) VALUES (?, ?, ?)');
      for (const m of members) {
        if (m.name && m.name.trim()) {
          memberStmt.run(candidateId, m.name.trim(), m.position ? m.position.trim() : '');
        }
      }

      db.exec('COMMIT');

      logAudit(req.admin.username, 'CREATE_CANDIDATE', `Menambah kandidat No. ${numInt} (${title})`, req.ip);

      return res.status(201).json({
        success: true,
        message: 'Kandidat berhasil dibuat',
        data: { id: candidateId, number: numInt, title }
      });
    } catch (txErr) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw txErr;
    }
  } catch (err) {
    console.error('Error createCandidate:', err);
    return res.status(500).json({ success: false, message: 'Gagal membuat kandidat baru: ' + err.message });
  }
}

export function updateCandidate(req, res) {
  try {
    const { id } = req.params;
    const { number, title, description, photo_url, is_active, members } = req.body;

    const numInt = parseInt(number, 10);
    const duplicate = db.prepare('SELECT id FROM candidates WHERE number = ? AND id != ?').get(numInt, id);
    if (duplicate) {
      return res.status(400).json({ success: false, message: `Nomor urut ${numInt} sudah digunakan oleh kandidat lain!` });
    }

    db.exec('BEGIN TRANSACTION');
    try {
      db.prepare(`
        UPDATE candidates 
        SET number = ?, title = ?, description = ?, photo_url = ?, is_active = ?, sort_order = ?
        WHERE id = ?
      `).run(numInt, title.trim(), description || '', photo_url || '', is_active ? 1 : 0, numInt, id);

      if (members && Array.isArray(members)) {
        db.prepare('DELETE FROM candidate_members WHERE candidate_id = ?').run(id);
        const memberStmt = db.prepare('INSERT INTO candidate_members (candidate_id, name, position) VALUES (?, ?, ?)');
        for (const m of members) {
          if (m.name && m.name.trim()) {
            memberStmt.run(id, m.name.trim(), m.position ? m.position.trim() : '');
          }
        }
      }

      db.exec('COMMIT');

      logAudit(req.admin.username, 'UPDATE_CANDIDATE', `Update kandidat id ${id} (No. ${numInt})`, req.ip);
      return res.json({ success: true, message: 'Data kandidat berhasil diperbarui' });
    } catch (txErr) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw txErr;
    }
  } catch (err) {
    console.error('Error updateCandidate:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui kandidat' });
  }
}

export function toggleCandidateActive(req, res) {
  try {
    const { id } = req.params;
    const candidate = db.prepare('SELECT id, is_active, number FROM candidates WHERE id = ?').get(id);
    if (!candidate) {
      return res.status(404).json({ success: false, message: 'Kandidat tidak ditemukan' });
    }

    const newStatus = candidate.is_active ? 0 : 1;
    db.prepare('UPDATE candidates SET is_active = ? WHERE id = ?').run(newStatus, id);

    logAudit(req.admin.username, 'TOGGLE_CANDIDATE', `Mengubah status kandidat No ${candidate.number} menjadi ${newStatus ? 'Aktif' : 'Nonaktif'}`, req.ip);

    return res.json({
      success: true,
      message: `Status kandidat berhasil diubah menjadi ${newStatus ? 'Aktif' : 'Nonaktif'}`,
      data: { is_active: newStatus }
    });
  } catch (err) {
    console.error('Error toggleCandidateActive:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengubah status kandidat' });
  }
}

export function deleteCandidate(req, res) {
  try {
    const { id } = req.params;
    const votesCount = db.prepare('SELECT COUNT(*) as count FROM votes WHERE candidate_id = ?').get(id).count;
    if (votesCount > 0 && req.query.force !== 'true') {
      return res.status(400).json({
        success: false,
        requiresForce: true,
        message: `PERINGATAN: Kandidat ini telah memperoleh ${votesCount} suara! Menghapus kandidat ini akan menghapus suaranya.`
      });
    }

    db.exec('BEGIN TRANSACTION');
    try {
      db.prepare('DELETE FROM votes WHERE candidate_id = ?').run(id);
      db.prepare('DELETE FROM candidate_members WHERE candidate_id = ?').run(id);
      db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
      db.exec('COMMIT');

      logAudit(req.admin.username, 'DELETE_CANDIDATE', `Menghapus kandidat id ${id}`, req.ip);
      return res.json({ success: true, message: 'Kandidat berhasil dihapus' });
    } catch (txErr) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw txErr;
    }
  } catch (err) {
    console.error('Error deleteCandidate:', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus kandidat' });
  }
}

// Upload file foto kandidat atau logo
export function uploadFile(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Tidak ada file yang diunggah' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    return res.json({
      success: true,
      message: 'File berhasil diunggah',
      data: {
        fileUrl,
        filename: req.file.filename,
        size: req.file.size
      }
    });
  } catch (err) {
    console.error('Error uploadFile:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengunggah file' });
  }
}

// --- SETTINGS ---
export function getSettings(req, res) {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const r of rows) {
      if (r.key !== 'spoiler_password_hash') {
        settings[r.key] = r.value;
      }
    }

    const logos = db.prepare('SELECT id, file_url, is_primary, position FROM logos ORDER BY position ASC').all();

    return res.json({
      success: true,
      data: {
        settings,
        logos
      }
    });
  } catch (err) {
    console.error('Error getSettings:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan' });
  }
}

export function updateSettings(req, res) {
  try {
    const { site_name, voting_open, idle_timeout, theme_default } = req.body;

    const upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    if (site_name !== undefined) upsert.run('site_name', String(site_name));
    if (voting_open !== undefined) upsert.run('voting_open', String(voting_open));
    if (idle_timeout !== undefined) upsert.run('idle_timeout', String(idle_timeout));
    if (theme_default !== undefined) upsert.run('theme_default', String(theme_default));

    logAudit(req.admin.username, 'UPDATE_SETTINGS', 'Pengaturan sistem diperbarui', req.ip);

    // Notifikasi update ke klien
    broadcastUpdate('settings_updated', { site_name, voting_open });

    return res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
  } catch (err) {
    console.error('Error updateSettings:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui pengaturan' });
  }
}

export function updateLogos(req, res) {
  try {
    const { logos } = req.body;
    if (!logos || !Array.isArray(logos)) {
      return res.status(400).json({ success: false, message: 'Format data logo tidak valid' });
    }

    if (logos.length > 3) {
      return res.status(400).json({ success: false, message: 'Maksimal hanya 3 logo yang diizinkan' });
    }

    db.exec('BEGIN TRANSACTION');
    try {
      db.prepare('DELETE FROM logos').run();
      const insert = db.prepare('INSERT INTO logos (file_url, is_primary, position) VALUES (?, ?, ?)');
      logos.forEach((logo, idx) => {
        insert.run(logo.file_url, logo.is_primary ? 1 : 0, idx + 1);
      });
      db.exec('COMMIT');

      logAudit(req.admin.username, 'UPDATE_LOGOS', 'Logo diperbarui', req.ip);
      return res.json({ success: true, message: 'Logo berhasil disimpan' });
    } catch (txErr) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw txErr;
    }
  } catch (err) {
    console.error('Error updateLogos:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui logo' });
  }
}

export async function changeAdminPassword(req, res) {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Password lama dan baru wajib diisi' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Konfirmasi password baru tidak cocok' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password baru minimal 8 karakter' });
    }

    const admin = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(req.admin.id);
    const match = await bcrypt.compare(oldPassword, admin.password_hash);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Password lama salah!' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(newHash, req.admin.id);

    logAudit(req.admin.username, 'CHANGE_PASSWORD', 'Admin mengganti password akun', req.ip);
    return res.json({ success: true, message: 'Password admin berhasil diganti' });
  } catch (err) {
    console.error('Error changeAdminPassword:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengganti password admin' });
  }
}

export async function changeSpoilerPassword(req, res) {
  try {
    const { adminPassword, newSpoilerPassword } = req.body;

    if (!adminPassword || !newSpoilerPassword) {
      return res.status(400).json({ success: false, message: 'Password admin dan password spoiler baru wajib diisi' });
    }

    const admin = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(req.admin.id);
    const match = await bcrypt.compare(adminPassword, admin.password_hash);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Password admin salah untuk konfirmasi perubahan!' });
    }

    const newHash = await bcrypt.hash(newSpoilerPassword, 10);
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('spoiler_password_hash', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(newHash);

    logAudit(req.admin.username, 'CHANGE_SPOILER_PASSWORD', 'Password spoiler diganti', req.ip);
    return res.json({ success: true, message: 'Password spoiler berhasil diperbarui' });
  } catch (err) {
    console.error('Error changeSpoilerPassword:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui password spoiler' });
  }
}

// Reset Voting (Konfirmasi Ganda: kata RESET + Password Admin)
export async function resetVoting(req, res) {
  try {
    const { confirmationText, adminPassword } = req.body;

    if (confirmationText !== 'RESET') {
      return res.status(400).json({ success: false, message: 'Teks konfirmasi harus tepat bernilai: RESET' });
    }

    if (!adminPassword) {
      return res.status(400).json({ success: false, message: 'Password admin wajib diisi untuk verifikasi reset' });
    }

    const admin = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(req.admin.id);
    const match = await bcrypt.compare(adminPassword, admin.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Password admin salah! Reset dibatalkan.' });
    }

    // Buat backup data sebelum reset
    const backupDir = path.resolve('server/uploads/backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const backupData = {
      resetAt: new Date().toISOString(),
      resetBy: req.admin.username,
      totalVotes: db.prepare('SELECT COUNT(*) as c FROM votes').get().c,
      votesSummary: db.prepare(`
        SELECT c.number, c.title, COUNT(v.id) as vote_count
        FROM candidates c
        LEFT JOIN votes v ON v.candidate_id = c.id
        GROUP BY c.id
      `).all(),
      studentsStatus: db.prepare('SELECT id, nis, name, class, has_voted, voted_at FROM students').all()
    };

    const backupFileName = `backup-voting-before-reset-${Date.now()}.json`;
    fs.writeFileSync(path.join(backupDir, backupFileName), JSON.stringify(backupData, null, 2));

    // Eksekusi Reset
    db.exec('BEGIN TRANSACTION');
    try {
      db.prepare('DELETE FROM votes').run();
      db.prepare('UPDATE students SET has_voted = 0, voted_at = NULL').run();
      db.exec('COMMIT');

      logAudit(req.admin.username, 'RESET_VOTING', `Reset pemilihan dilakukan. Backup tersimpan di ${backupFileName}`, req.ip);

      broadcastUpdate('vote_updated', {
        total: db.prepare('SELECT COUNT(*) as c FROM students').get().c,
        voted: 0,
        percent: 0,
        timestamp: new Date().toISOString()
      });

      return res.json({
        success: true,
        message: 'Voting berhasil direset! Seluruh suara telah dikosongkan dan status siswa dikembalikan menjadi belum memilih.',
        backupFile: backupFileName
      });
    } catch (txErr) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw txErr;
    }
  } catch (err) {
    console.error('Error resetVoting:', err);
    return res.status(500).json({ success: false, message: 'Gagal melakukan reset sistem: ' + err.message });
  }
}

// Audit Logs
export function getAuditLogs(req, res) {
  try {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all();
    return res.json({ success: true, data: logs });
  } catch (err) {
    console.error('Error getAuditLogs:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil log audit' });
  }
}
