# E-Voting OSIS - Aplikasi Pemilihan Suara Berbasis Web

Aplikasi E-Voting modern, aman, transparan, dan responsif yang dirancang untuk pemilihan ketua dan wakil OSIS di sekolah. Mendukung login scan QR kartu pemilih, input manual NIS, dashboard admin realtime dengan perlindungan mode spoiler, manajemen kandidat dinamis (anggota tunggal, berpasangan, atau bertiga), crop foto, impor/ekspor data pemilih, dan pencetakan kartu pemilih QR.

---

## 🛠️ Tech Stack

- **Frontend**: React.js (Vite), React Router v6, Tailwind CSS (dengan `darkMode: 'class'`), Lucide Icons, Axios, Socket.IO Client, HTML5-QRCode, React-Easy-Crop.
- **Backend**: Node.js, Express.js, Socket.IO, Better-SQLite3 / Node:SQLite, JWT (JsonWebToken), Bcryptjs, Multer, Helmet, Cors, Express-Rate-Limit.
- **Database**: SQLite (ACID compliant, transaksi atomik untuk kerahasiaan suara).

---

## 🚀 Panduan Memulai Cepat

### 1. Instalasi Seluruh Dependensi

Di direktori root project, jalankan:
```bash
npm run install:all
```
*Atau lakukan instalasi mandiri:*
```bash
npm install
cd server && npm install
cd ../client && npm install
```

### 2. Konfigurasi Lingkungan (.env)
Salin `.env.example` ke `server/.env`:
```bash
cp .env.example server/.env
```

Isi default konfigurasi:
```env
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
JWT_SECRET=supersecret_jwt_key_evoting_osis_2026_change_in_production
DB_PATH=./src/db/voting.sqlite
```

### 3. Menjalankan Aplikasi (Development)
Cukup jalankan satu perintah dari root project:
```bash
npm run dev
```

Aplikasi akan otomatis berjalan pada:
- **Frontend (Client)**: [http://localhost:5173](http://localhost:5173)
- **Backend API (Server)**: [http://localhost:5000](http://localhost:5000)

*Catatan: Database dan seeder data awal akan dijalankan secara otomatis saat server pertama kali diaktifkan.*

---

## 🔑 Akun & Kredensial Default

| Peran | Username / NIS | Password | Keterangan |
|---|---|---|---|
| **Admin** | `administrator` | `adminosis` | Akses panel admin penuh via `/admin/login` |
| **Password Spoiler** | - | `spoiler123` | Membuka overview & rekapitulasi perolehan suara |
| **Siswa Contoh 1** | `24011835` | (Cukup NIS) | Taufiq Iman Putra (XII MIPA 1) |
| **Siswa Contoh 2** | `24011836` | (Cukup NIS) | Ahmad Fauzi Rahman (XII MIPA 2) |
| **Siswa Contoh 3** | `24011837` | (Cukup NIS) | Siti Nurhaliza (XII IPS 1) |
| **Siswa Contoh 4** | `24011838` | (Cukup NIS) | Budi Santoso (XII IPS 2) |

---

## 🌟 Fitur Utama

1. **Halaman Siswa (Login & Voting)**:
   - **Scan QR Kamera**: Mendeteksi kode QR dari kartu pemilih dengan overlay bingkai presisi dan penggantian kamera (depan/belakang).
   - **Input Manual NIS**: Alternatif jika kartu rusak atau kamera tidak diizinkan.
   - **Kandidat Fleksibel**: Menampilkan kandidat aktif dalam tata letak responsif (1 kandidat di tengah, 2 sejajar, 3+ kartu dalam grid).
   - **Alur Voting Aman**: Klik kartu &rarr; Modal Visi-Misi & Anggota lengkap &rarr; Dialog Konfirmasi &rarr; Suara Tercatat & Sesi Dihapus otomatis.
   - **Pencegahan Double-Vote**: Transaksi database atomik dan penolakan langsung bagi siswa yang sudah memilih.
   - **Idle Timeout**: Otomatis logout setelah batas waktu tidak aktif (dapat diatur di Settings).

2. **Admin Dashboard**:
   - **Overview Realtime**: Menampilkan persentase partisipasi pemilih (`X% sudah voting (Y / Z)`) secara langsung tanpa perlu password spoiler.
   - **Log Kehadiran Pemilih Terkini (Maksimal 25)**: Tabel log di bawah progress bar partisipasi yang menampilkan maksimal 25 siswa yang baru saja memberikan hak suara secara realtime (antrean lebih dari 25 secara otomatis tergeser/dihapus dari daftar pantau).
   - **Rekapitulasi Suara (Spoiler Protected)**: Perolehan suara per kandidat tetap dilindungi password spoiler. Daftar pemilih hadir **tidak memuat** pilihan individu demi menjaga asas LUBER.
   - **Manajemen Siswa**: Tambah, edit, hapus, hapus massal, filter kelas, dan pencarian.
   - **Impor & Ekspor Data Siswa**:
     - Unduh template CSV/XLSX.
     - Pratinjau data sebelum disimpan (validasi NIS kosong/duplikat).
     - Pilihan lewati atau perbarui data.
     - Ekspor data siswa ke file `.xlsx` atau `.csv`.
   - **Cetak Kartu Pemilih QR**: Generate massal atau satuan kartu pemilih lengkap dengan logo dan QR NIS siap cetak atau simpan ke PDF.
   - **Kelola Kandidat (Data Vote & Create Vote)**:
     - Tambah kandidat dengan jumlah anggota dinamis (1, 2, 3, ... N anggota).
     - Upload foto dengan fitur interaktif **Crop Rasio** (1:1, 4:3, 16:9), Zoom, dan Rotasi.
     - Toggle aktif/nonaktif dan peringatan jika kandidat yang dihapus sudah memiliki suara.
   - **Pengaturan & Keamanan (Settings)**:
     - Ubah nama website/pemilihan.
     - Unggah hingga 3 logo (dengan 1 logo inti penanda).
     - Buka/tutup status pemilihan.
     - Ubah password admin & password spoiler.
     - **Reset Pemilihan**: Konfirmasi ganda (`RESET` + password admin) disertai pembuatan backup file `.json` otomatis sebelum reset.
   - **Tema Terang & Gelap (Dark Mode)**: Tersedia toggle global di halaman siswa dan admin dengan penyimpanan di `localStorage`.

---

## 🔒 Asumsi & Keputusan Desain

1. **Kerahasiaan Suara**: Tabel `votes` (`id`, `candidate_id`, `created_at`) tidak menyimpan relasi ke `student_id`. Pelacakan kehadiran pemilih dilakukan di tabel `students` via kolom `has_voted` dan `voted_at`. Hal ini mencegah admin sekalipun mengetahui siapa memilih kandidat tertentu.
2. **Kamera & Scan QR**: Browser mewajibkan konteks aman (HTTPS atau `localhost`) untuk mengakses sensor kamera. Untuk produksi, pastikan website diakses menggunakan HTTPS (SSL).
3. **Database Driver**: Menggunakan `node:sqlite` (SQLite DatabaseSync standar bawaan Node.js LTS), menjamin kompatibilitas 100% di semua versi Node.js tanpa risiko kegagalan build native `node-gyp`.
