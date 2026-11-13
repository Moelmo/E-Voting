import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, initDatabase } from './src/db/index.js';

initDatabase();

export async function runSeed(force = false) {
  console.log('--- Menjalankan Database Seeder ---');

  // Check if admin exists
  const existingAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get('administrator');
  if (!existingAdmin || force) {
    if (force) {
      db.prepare('DELETE FROM admins WHERE username = ?').run('administrator');
    }
    const adminPassHash = await bcrypt.hash('adminosis', 10);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('administrator', adminPassHash);
    console.log('✓ Akun admin dibuat: administrator / adminosis');
  } else {
    console.log('✓ Admin administrator sudah ada');
  }

  // Settings
  const defaultSettings = [
    { key: 'site_name', value: 'E-Voting OSIS' },
    { key: 'voting_open', value: '1' },
    { key: 'idle_timeout', value: '3' },
    { key: 'theme_default', value: 'system' }, // system, light, dark
    { key: 'spoiler_password_hash', value: await bcrypt.hash('spoiler123', 10) }
  ];

  const getSetting = db.prepare('SELECT key FROM settings WHERE key = ?');
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

  for (const s of defaultSettings) {
    if (!getSetting.get(s.key)) {
      insertSetting.run(s.key, s.value);
    }
  }
  console.log('✓ Default settings diinisialisasi');

  // Seed Students
  const defaultStudents = [
    { name: 'Taufiq Iman Putra', nis: '24011835', class: 'XII MIPA 1' },
    { name: 'Ahmad Fauzi Rahman', nis: '24011836', class: 'XII MIPA 2' },
    { name: 'Siti Nurhaliza', nis: '24011837', class: 'XII IPS 1' },
    { name: 'Budi Santoso', nis: '24011838', class: 'XII IPS 2' },
  ];

  const getStudent = db.prepare('SELECT id FROM students WHERE nis = ?');
  const insertStudent = db.prepare('INSERT INTO students (name, nis, class, has_voted) VALUES (?, ?, ?, 0)');

  for (const st of defaultStudents) {
    if (!getStudent.get(st.nis)) {
      insertStudent.run(st.name, st.nis, st.class);
    }
  }
  console.log('✓ Data siswa contoh dibuat (4 siswa)');

  // Seed Candidates
  const candidateCount = db.prepare('SELECT count(*) as count FROM candidates').get().count;
  if (candidateCount === 0 || force) {
    if (force) {
      db.prepare('DELETE FROM candidate_members').run();
      db.prepare('DELETE FROM candidates').run();
    }

    const insertCandidate = db.prepare(`
      INSERT INTO candidates (number, title, description, photo_url, is_active, sort_order)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    const insertMember = db.prepare(`
      INSERT INTO candidate_members (candidate_id, name, position)
      VALUES (?, ?, ?)
    `);

    // Kandidat 1: Tunggal
    const c1 = insertCandidate.run(
      1,
      'Visi & Misi Memajukan Sekolah Melalui Inovasi Digital',
      'Visi:\nMewujudkan OSIS yang responsif, berintegritas, dan inovatif di era digital.\n\nMisi:\n1. Mengoptimalkan platform digital untuk aspirasi siswa.\n2. Mengadakan workshop teknologi dan kepemimpinan berkala.\n3. Membangun solidaritas antar angkatan melalui pekan kreasi seni.',
      '/uploads/sample-c1.png',
      1
    );
    insertMember.run(c1.lastInsertRowid, 'Muhammad Fathir Al-Ghifari', 'Calon Ketua');

    // Kandidat 2: Berpasangan (2 orang)
    const c2 = insertCandidate.run(
      2,
      'Sinergi Membangun Prestasi Akademik & Karakter Berakhlak',
      'Visi:\nTerwujudnya siswa berprestasi, berkarakter, dan berwawasan lingkungan.\n\nMisi:\n1. Peningkatan wadah ekstrakurikuler sains, seni, dan olahraga.\n2. Gerakan peduli lingkungan sekolah hijau dan bebas sampah plastik.\n3. Forum diskusi terbuka bersama perwakilan kelas setiap bulan.',
      '/uploads/sample-c2.png',
      2
    );
    insertMember.run(c2.lastInsertRowid, 'Nadia Putri Khairunnisa', 'Calon Ketua');
    insertMember.run(c2.lastInsertRowid, 'Rizky Pratama', 'Calon Wakil Ketua');

    // Kandidat 3: Tiga orang (Presidium/Kandidat Bertiga)
    const c3 = insertCandidate.run(
      3,
      'Kolaborasi Tiga Pilar: Kreatif, Kritis, dan Berbudaya',
      'Visi:\nMembangun ekosistem sekolah yang inklusif, kreatif, dan berdaya saing global dengan tetap menjunjung kearifan lokal.\n\nMisi:\n1. Festival kebudayaan tahunan skala kota.\n2. Pendampingan mentoring belajar antar rekan sebaya (peer tutoring).\n3. Pelayanan pengaduan siswa yang aman dan transparan.',
      '/uploads/sample-c3.png',
      3
    );
    insertMember.run(c3.lastInsertRowid, 'Zahra Amelia Lestari', 'Ketua Umum');
    insertMember.run(c3.lastInsertRowid, 'Dimas Arya Yudha', 'Wakil Ketua 1 (Internal)');
    insertMember.run(c3.lastInsertRowid, 'Clarissa Anindya', 'Wakil Ketua 2 (Eksternal)');

    console.log('✓ Kandidat contoh dibuat (1 orang, 2 orang, 3 orang)');
  } else {
    console.log('✓ Data kandidat sudah ada');
  }

  // Sample Logos
  const logoCount = db.prepare('SELECT count(*) as count FROM logos').get().count;
  if (logoCount === 0) {
    const insertLogo = db.prepare('INSERT INTO logos (file_url, is_primary, position) VALUES (?, ?, ?)');
    insertLogo.run('/uploads/logo-tutwuri.png', 0, 1);
    insertLogo.run('/uploads/logo-osis.png', 1, 2); // Primary logo
    insertLogo.run('/uploads/logo-sekolah.png', 0, 3);
    console.log('✓ Default logos diatur (3 logo: Tutwuri, OSIS [inti], Sekolah)');
  }

  console.log('--- Database Seeder Selesai ---');
}

// Jalankan jika dieksekusi langsung
if (process.argv[1]?.endsWith('seed.js')) {
  runSeed().catch(console.error);
}
