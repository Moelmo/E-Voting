import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_jwt_key_evoting_osis_2026';

export function authenticateAdmin(req, res, next) {
  // Dukung Bearer token di header maupun query param ?token= (berguna untuk link download langsung seperti window.open / tag <a>)
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Akses ditolak: Token admin tidak disediakan' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak: Bukan akun administrator' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Sesi admin telah kedaluwarsa atau token tidak valid' });
  }
}

export function authenticateStudent(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Akses ditolak: Token siswa tidak ditemukan' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Akses ditolak: Bukan token siswa' });
    }
    req.student = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Sesi memilih Anda telah kedaluwarsa, silakan scan/login kembali' });
  }
}

export function generateToken(payload, expiresIn = '1h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}
