const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ONLYOFFICE Document Server 주소 및 호스트 설정
const BACKEND_HOST = process.env.BACKEND_HOST || 'http://host.docker.internal:3000';
const ONLYOFFICE_SERVER = process.env.ONLYOFFICE_SERVER || 'http://localhost:8080';

// PostgreSQL 연동 설정 (제공해주신 DB 커넥션 정보)
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'cmm_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '1234',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

app.use(cors());
app.use(express.json({ limit: '700mb' }));
app.use(express.urlencoded({ extended: true, limit: '700mb' }));

// 세션 미들웨어 등록
app.use(session({
  secret: 'onlyoffice-session-secret-key-13579',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24시간 유지
    secure: false, // 로컬 개발 테스트를 위해 false
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// 문서 및 템플릿 디렉토리 설정
const DOCUMENTS_DIR = path.join(__dirname, 'documents');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const PERSONAL_DIR = path.join(__dirname, 'personal_documents');
const SPREADSHEET_TEMPLATE_PATH = path.join(TEMPLATES_DIR, 'defect_template.xlsx');
const WORD_TEMPLATE_PATH = path.join(TEMPLATES_DIR, 'defect_template.docx');
const POWERPOINT_TEMPLATE_PATH = path.join(TEMPLATES_DIR, 'defect_template.pptx');

// 사용자 비밀번호 SHA-256 해싱 함수
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// 인증 미들웨어
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  next();
}

// 서버 기동 시 DB 및 템플릿 파일 기동 초기화
async function initProject() {
  // 1. 디렉토리 생성
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
  if (!fs.existsSync(PERSONAL_DIR)) {
    fs.mkdirSync(PERSONAL_DIR, { recursive: true });
  }

  // 2. PostgreSQL 테이블 초기화 및 관리자 계정 생성
  console.log('PostgreSQL 연결 및 테이블 유효성 검사 중...');
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS onlyoffice_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 계정 잠금 및 로그인 시도 횟수 컬럼 추가 (마이그레이션)
    await pool.query(`
      ALTER TABLE onlyoffice_users ADD COLUMN IF NOT EXISTS login_attempts INT DEFAULT 0;
    `);
    await pool.query(`
      ALTER TABLE onlyoffice_users ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
    `);

    // 문서 메타데이터 테이블 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS onlyoffice_documents (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        creator VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 기존 공유 파일 메타데이터 마이그레이션 (소급 적용)
    if (fs.existsSync(DOCUMENTS_DIR)) {
      const files = fs.readdirSync(DOCUMENTS_DIR)
        .filter(file => file.endsWith('.xlsx') || file.endsWith('.docx') || file.endsWith('.pptx'));
      for (const file of files) {
        const docCheck = await pool.query('SELECT * FROM onlyoffice_documents WHERE filename = $1', [file]);
        if (docCheck.rows.length === 0) {
          await pool.query('INSERT INTO onlyoffice_documents (filename, creator) VALUES ($1, $2)', [file, 'admin']);
          console.log(`기존 공유 문서 메타데이터 등록 완료: ${file} (작성자: admin)`);
        }
      }
    }

    // 관리자 계정이 존재하는지 확인
    const adminCheck = await pool.query('SELECT * FROM onlyoffice_users WHERE username = $1', ['admin']);
    if (adminCheck.rows.length === 0) {
      console.log('기본 관리자 계정이 존재하지 않아 새로 등록합니다...');
      const adminPassHash = hashPassword('admin123');
      await pool.query(`
        INSERT INTO onlyoffice_users (username, name, password, status, role)
        VALUES ($1, $2, $3, $4, $5)
      `, ['admin', '시스템 관리자', adminPassHash, 'approved', 'admin']);
      console.log('기본 관리자 계정 생성 성공! (아이디: admin / 비밀번호: admin123)');
    } else {
      console.log('기본 관리자 계정 감지 완료.');
    }
  } catch (dbErr) {
    console.error('PostgreSQL 초기화 중 치명적 오류 발생:', dbErr.message);
    console.log('※ 주의: DB 서버 기동 상태 또는 방화벽/접속 정보를 다시 확인해 주세요.');
  }

  // 3. 스프레드시트 템플릿 파일 자동 생성
  if (!fs.existsSync(SPREADSHEET_TEMPLATE_PATH)) {
    console.log('스프레드시트 템플릿 파일이 없어 새로 생성합니다...');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('결함정리시트');
    sheet.views = [{ showGridLines: true }];

    sheet.columns = [
      { header: '결함 ID', key: 'id', width: 12 },
      { header: '구분', key: 'category', width: 15 },
      { header: '결함 제목', key: 'title', width: 35 },
      { header: '상세 내용 및 재현 경로', key: 'description', width: 50 },
      { header: '심각도', key: 'severity', width: 12 },
      { header: '진행 상태', key: 'status', width: 12 },
      { header: '담당자', key: 'assignee', width: 15 },
      { header: '등록자', key: 'reporter', width: 15 },
      { header: '등록일', key: 'created_date', width: 15 },
      { header: '조치일', key: 'completed_date', width: 15 }
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F4E78' }
      };
      cell.font = { name: '맑은 고딕', color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'medium', color: { argb: 'FF1F4E78' } },
        left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
      };
    });

    const sampleData = [
      {
        id: 'DEF-001',
        category: '기능 오류',
        title: '로그인 화면에서 비밀번호 찾기 링크 동작 안 함',
        description: '로그인 화면의 [비밀번호를 잊으셨나요?] 링크를 클릭해도 반응이 없거나 404 에러가 발생함.',
        severity: '높음',
        status: '진행중',
        assignee: '김개발',
        reporter: '이테스터',
        created_date: '2026-07-23',
        completed_date: ''
      }
    ];

    sampleData.forEach(item => sheet.addRow(item));

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.height = 22;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: '맑은 고딕', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
        };
        if ([1, 2, 5, 6, 7, 8, 9, 10].includes(colNumber)) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
      });
    });

    await workbook.xlsx.writeFile(SPREADSHEET_TEMPLATE_PATH);
    console.log('스프레드시트 템플릿 생성 완료.');
  }
}

// ==========================================
// [인증 관련 API]
// ==========================================

// 1. 회원 신청 (회원가입 신청)
app.post('/api/auth/register', async (req, res) => {
  const { username, name, password } = req.body;
  if (!username || !name || !password) {
    return res.status(400).json({ error: '필수 가입 정보가 모두 입력되지 않았습니다.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const cleanName = name.trim();

  try {
    // 중복 체크
    const userCheck = await pool.query('SELECT * FROM onlyoffice_users WHERE username = $1', [cleanUsername]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });
    }

    const passHash = hashPassword(password);
    // 기본 status는 pending(대기중)으로 가입됩니다.
    await pool.query(`
      INSERT INTO onlyoffice_users (username, name, password, status, role)
      VALUES ($1, $2, $3, $4, $5)
    `, [cleanUsername, cleanName, passHash, 'pending', 'user']);

    console.log(`[회원가입 신청] ID: ${cleanUsername}, 이름: ${cleanName}`);
    res.json({ success: true, message: '가입 신청이 정상 접수되었습니다. 관리자의 승인 후 사용하실 수 있습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '회원 가입 신청 중 서버 오류가 발생했습니다.' });
  }
});

// 2. 로그인
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 모두 입력해 주세요.' });
  }

  const cleanUsername = username.trim().toLowerCase();

  try {
    const result = await pool.query('SELECT * FROM onlyoffice_users WHERE username = $1', [cleanUsername]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: '가입되지 않은 아이디이거나 비밀번호가 다릅니다.' });
    }

    const user = result.rows[0];

    // 계정 잠금 상태 확인
    if (user.is_locked) {
      return res.status(403).json({ error: '비밀번호 5회 오류로 계정이 잠겼습니다. 관리자에게 문의하세요.' });
    }

    const passHash = hashPassword(password);

    if (user.password !== passHash) {
      const attempts = (user.login_attempts || 0) + 1;
      let errorMsg = `가입되지 않은 아이디이거나 비밀번호가 다릅니다. (오류 횟수: ${attempts}/5)`;

      if (attempts >= 5) {
        await pool.query('UPDATE onlyoffice_users SET login_attempts = $1, is_locked = TRUE WHERE username = $2', [attempts, cleanUsername]);
        errorMsg = '비밀번호 5회 오류로 계정이 잠겼습니다. 관리자에게 문의하세요.';
      } else {
        await pool.query('UPDATE onlyoffice_users SET login_attempts = $1 WHERE username = $2', [attempts, cleanUsername]);
      }
      return res.status(400).json({ error: errorMsg });
    }

    // 로그인 성공 시 로그인 시도 횟수 리셋
    if (user.login_attempts > 0) {
      await pool.query('UPDATE onlyoffice_users SET login_attempts = 0 WHERE username = $1', [cleanUsername]);
    }

    // 승인 상태 검증
    if (user.status !== 'approved') {
      if (user.status === 'pending') {
        return res.status(403).json({ error: '가입 신청 승인 대기 중인 계정입니다. 관리자의 승인을 기다려 주세요.' });
      } else if (user.status === 'rejected') {
        return res.status(403).json({ error: '가입 신청이 거절된 계정입니다. 관리자에게 문의하세요.' });
      } else if (user.status === 'pending_withdrawal') {
        return res.status(403).json({ error: '탈퇴 신청 처리 대기 중인 계정입니다. 로그인할 수 없습니다.' });
      }
    }

    // 세션 정보 등록
    req.session.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role
    };

    console.log(`[로그인 성공] ID: ${user.username}, 이름: ${user.name}, 역할: ${user.role}`);
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '로그인 도중 서버 오류가 발생했습니다.' });
  }
});

// 3. 로그아웃
app.post('/api/auth/logout', requireLogin, (req, res) => {
  const username = req.session.user.username;
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: '로그아웃 중 오류가 발생했습니다.' });
    }
    console.log(`[로그아웃 완료] ID: ${username}`);
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// 4. 세션 확인 API
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ loggedIn: true, user: req.session.user });
  }
  res.json({ loggedIn: false });
});

// 5. 비밀번호 변경 API
app.post('/api/auth/change-password', requireLogin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.' });
  }

  const username = req.session.user.username;

  try {
    // DB에서 사용자 조회
    const result = await pool.query('SELECT * FROM onlyoffice_users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const user = result.rows[0];
    const currentHash = hashPassword(currentPassword);

    if (user.password !== currentHash) {
      return res.status(400).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
    }

    const newHash = hashPassword(newPassword);
    await pool.query('UPDATE onlyoffice_users SET password = $1 WHERE username = $2', [newHash, username]);

    console.log(`[비밀번호 변경 성공] ID: ${username}`);
    res.json({ success: true, message: '비밀번호가 성공적으로 변경되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '비밀번호 변경 도중 서버 오류가 발생했습니다.' });
  }
});

// 6. 회원 탈퇴 API (본인 탈퇴 신청)
app.post('/api/auth/withdraw', requireLogin, async (req, res) => {
  const username = req.session.user.username;

  if (username === 'admin') {
    return res.status(400).json({ error: '기본 관리자 계정은 탈퇴할 수 없습니다.' });
  }

  try {
    // DB에서 상태를 'pending_withdrawal'로 업데이트
    await pool.query("UPDATE onlyoffice_users SET status = 'pending_withdrawal' WHERE username = $1", [username]);
    console.log(`[회원 탈퇴 신청 완료] ID: ${username}`);

    // 세션 파괴 및 쿠키 삭제
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: '탈퇴 신청 처리 도중 세션 정리에 실패했습니다.' });
      }
      res.clearCookie('connect.sid');
      res.json({ success: true, message: '회원 탈퇴 신청이 정상적으로 완료되었습니다. 관리자 확인 후 탈퇴 처리가 완료됩니다.' });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '회원 탈퇴 신청 처리 도중 서버 오류가 발생했습니다.' });
  }
});

// ==========================================
// [어드민 전용 사용자 관리 API]
// ==========================================

// 1. 전체 사용자 목록 조회
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, name, status, role, login_attempts, is_locked, created_at 
      FROM onlyoffice_users 
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '사용자 목록을 불러오는 중 오류가 발생했습니다.' });
  }
});

// 2. 가입 신청 승인
app.post('/api/admin/users/approve', requireAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '대상이 지정되지 않았습니다.' });

  try {
    await pool.query('UPDATE onlyoffice_users SET status = $1 WHERE username = $2', ['approved', username]);
    console.log(`[어드민 권한] 가입 승인 완료: ${username}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '승인 처리 도중 오류가 발생했습니다.' });
  }
});

// 3. 가입 신청 거절
app.post('/api/admin/users/reject', requireAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '대상이 지정되지 않았습니다.' });

  try {
    await pool.query('UPDATE onlyoffice_users SET status = $1 WHERE username = $2', ['rejected', username]);
    console.log(`[어드민 권한] 가입 거절 완료: ${username}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '거절 처리 도중 오류가 발생했습니다.' });
  }
});

// 4. 강제 탈퇴 (삭제)
app.post('/api/admin/users/withdraw', requireAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '대상이 지정되지 않았습니다.' });
  if (username === 'admin') return res.status(400).json({ error: '기본 관리자 계정은 탈퇴시킬 수 없습니다.' });

  try {
    await pool.query('DELETE FROM onlyoffice_users WHERE username = $1', [username]);
    console.log(`[어드민 권한] 강제 탈퇴(삭제) 완료: ${username}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '탈퇴 처리 도중 오류가 발생했습니다.' });
  }
});

// 5. 계정 잠김 해제 API
app.post('/api/admin/users/unlock', requireAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '대상이 지정되지 않았습니다.' });

  try {
    await pool.query('UPDATE onlyoffice_users SET is_locked = FALSE, login_attempts = 0 WHERE username = $1', [username]);
    console.log(`[어드민 권한] 계정 잠금 해제 완료: ${username}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '잠금 해제 처리 도중 오류가 발생했습니다.' });
  }
});

// 6. 비밀번호 초기화 API (비밀번호를 '1234'로 초기화)
app.post('/api/admin/users/reset-password', requireAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '대상이 지정되지 않았습니다.' });

  try {
    const passHash = hashPassword('1234');
    await pool.query('UPDATE onlyoffice_users SET password = $1 WHERE username = $2', [passHash, username]);
    console.log(`[어드민 권한] 비밀번호 초기화 완료(1234): ${username}`);
    res.json({ success: true, defaultPassword: '1234' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '비밀번호 초기화 도중 오류가 발생했습니다.' });
  }
});

// ==========================================
// [기본 문서 관리 API (로그인 필요 설정)]
// ==========================================

// 1. 문서 목록 조회 API
app.get('/api/files', requireLogin, async (req, res) => {
  const box = req.query.box || 'shared';
  const targetUser = req.query.targetUser || 'all';

  try {
    // DB에서 모든 문서 메타데이터 조회하여 작성자 매핑 준비
    const docMetaResult = await pool.query('SELECT filename, creator FROM onlyoffice_documents');
    const creatorMap = new Map();
    docMetaResult.rows.forEach(row => {
      creatorMap.set(row.filename, row.creator);
    });

    let filesToProcess = []; // { name, filePath, owner }

    if (box === 'personal') {
      const isParamAdmin = req.session.user.role === 'admin';

      if (isParamAdmin) {
        if (targetUser === 'all') {
          // 전체 유저의 개인 폴더 조회
          if (fs.existsSync(PERSONAL_DIR)) {
            const users = fs.readdirSync(PERSONAL_DIR);
            for (const u of users) {
              const uDir = path.join(PERSONAL_DIR, u);
              if (fs.statSync(uDir).isDirectory()) {
                const files = fs.readdirSync(uDir).filter(file => file.endsWith('.xlsx') || file.endsWith('.docx') || file.endsWith('.pptx'));
                files.forEach(file => {
                  filesToProcess.push({
                    name: file,
                    filePath: path.join(uDir, file),
                    owner: u
                  });
                });
              }
            }
          }
        } else {
          // 특정 유저의 개인 폴더 조회
          const uDir = path.join(PERSONAL_DIR, targetUser);
          if (!fs.existsSync(uDir)) {
            fs.mkdirSync(uDir, { recursive: true });
          }
          const files = fs.readdirSync(uDir).filter(file => file.endsWith('.xlsx') || file.endsWith('.docx') || file.endsWith('.pptx'));
          files.forEach(file => {
            filesToProcess.push({
              name: file,
              filePath: path.join(uDir, file),
              owner: targetUser
            });
          });
        }
      } else {
        // 일반 사용자는 본인 개인 폴더 조회
        const uDir = path.join(PERSONAL_DIR, req.session.user.username);
        if (!fs.existsSync(uDir)) {
          fs.mkdirSync(uDir, { recursive: true });
        }
        const files = fs.readdirSync(uDir).filter(file => file.endsWith('.xlsx') || file.endsWith('.docx') || file.endsWith('.pptx'));
        files.forEach(file => {
          filesToProcess.push({
            name: file,
            filePath: path.join(uDir, file),
            owner: req.session.user.username
          });
        });
      }
    } else {
      // 공유 문서함 조회
      if (fs.existsSync(DOCUMENTS_DIR)) {
        const files = fs.readdirSync(DOCUMENTS_DIR).filter(file => file.endsWith('.xlsx') || file.endsWith('.docx') || file.endsWith('.pptx'));
        files.forEach(file => {
          filesToProcess.push({
            name: file,
            filePath: path.join(DOCUMENTS_DIR, file),
            owner: 'shared'
          });
        });
      }
    }

    const files = filesToProcess.map(item => {
      const stats = fs.statSync(item.filePath);
      let type = 'cell';
      if (item.name.endsWith('.docx')) type = 'word';
      if (item.name.endsWith('.pptx')) type = 'slide';

      return {
        name: item.name,
        size: stats.size,
        mtime: stats.mtime,
        type: type,
        key: getDocumentKey(item.name, stats.mtime),
        creator: creatorMap.get(item.name) || 'admin',
        owner: item.owner
      };
    });

    files.sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '파일 목록 조회 중 오류가 발생했습니다.' });
  }
});

// 2. 문서 생성 API
app.post('/api/files/create', requireLogin, async (req, res) => {
  const { filename, type, box } = req.body;
  if (!filename || !type) {
    return res.status(400).json({ error: '파일명 또는 문서 타입이 누락되었습니다.' });
  }

  const activeBox = box || 'shared';
  const username = req.session.user.username;

  let ext = '.xlsx';
  let templatePath = SPREADSHEET_TEMPLATE_PATH;

  if (type === 'word') {
    ext = '.docx';
    templatePath = WORD_TEMPLATE_PATH;
  } else if (type === 'slide') {
    ext = '.pptx';
    templatePath = POWERPOINT_TEMPLATE_PATH;
  }

  let cleanName = filename.trim();
  if (!cleanName.endsWith(ext)) {
    cleanName += ext;
  }

  // 글로벌 중복 검사 (동일 파일명 충돌 방지)
  let fileExistsGlobally = false;
  if (fs.existsSync(path.join(DOCUMENTS_DIR, cleanName))) {
    fileExistsGlobally = true;
  } else {
    if (fs.existsSync(PERSONAL_DIR)) {
      const users = fs.readdirSync(PERSONAL_DIR);
      for (const u of users) {
        if (fs.existsSync(path.join(PERSONAL_DIR, u, cleanName))) {
          fileExistsGlobally = true;
          break;
        }
      }
    }
  }

  if (fileExistsGlobally) {
    return res.status(400).json({ error: '동일한 이름의 파일이 이미 문서함에 존재합니다.' });
  }

  if (!fs.existsSync(templatePath)) {
    return res.status(500).json({ error: '지정된 문서 타입의 템플릿 파일이 존재하지 않습니다.' });
  }

  let destDir = DOCUMENTS_DIR;
  if (activeBox === 'personal') {
    destDir = path.join(PERSONAL_DIR, username);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
  }
  const destPath = path.join(destDir, cleanName);

  try {
    fs.copyFileSync(templatePath, destPath);

    // DB에 문서 작성자 메타데이터 등록
    await pool.query('INSERT INTO onlyoffice_documents (filename, creator) VALUES ($1, $2) ON CONFLICT (filename) DO UPDATE SET creator = $2', [cleanName, username]);

    console.log(`새로운 문서 생성 완료 (${type}, 저장소: ${activeBox}): ${cleanName} (작성자: ${username})`);
    res.json({ success: true, filename: cleanName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '파일을 생성하는 도중 오류가 발생했습니다.' });
  }
});

// 3. 파일 업로드 API (Base64 형식 수신)
app.post('/api/files/upload', requireLogin, async (req, res) => {
  const { filename, base64, box } = req.body;
  if (!filename || !base64) {
    return res.status(400).json({ error: '파일명 또는 파일 데이터가 누락되었습니다.' });
  }

  const activeBox = box || 'shared';
  const username = req.session.user.username;

  const cleanName = filename.trim();
  if (!cleanName.endsWith('.xlsx') && !cleanName.endsWith('.docx') && !cleanName.endsWith('.pptx')) {
    return res.status(400).json({ error: '허용되지 않는 파일 형식입니다. (.xlsx, .docx, .pptx만 가능)' });
  }

  // 글로벌 중복 검사 (동일 파일명 충돌 방지)
  let fileExistsGlobally = false;
  if (fs.existsSync(path.join(DOCUMENTS_DIR, cleanName))) {
    fileExistsGlobally = true;
  } else {
    if (fs.existsSync(PERSONAL_DIR)) {
      const users = fs.readdirSync(PERSONAL_DIR);
      for (const u of users) {
        if (fs.existsSync(path.join(PERSONAL_DIR, u, cleanName))) {
          fileExistsGlobally = true;
          break;
        }
      }
    }
  }

  if (fileExistsGlobally) {
    return res.status(400).json({ error: '동일한 이름의 파일이 이미 문서함에 존재합니다.' });
  }

  let destDir = DOCUMENTS_DIR;
  if (activeBox === 'personal') {
    destDir = path.join(PERSONAL_DIR, username);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
  }
  const destPath = path.join(destDir, cleanName);

  try {
    fs.writeFileSync(destPath, Buffer.from(base64, 'base64'));

    // DB에 문서 작성자 메타데이터 등록
    await pool.query('INSERT INTO onlyoffice_documents (filename, creator) VALUES ($1, $2) ON CONFLICT (filename) DO UPDATE SET creator = $2', [cleanName, username]);

    console.log(`파일 업로드 완료 (${activeBox}): ${cleanName} (작성자: ${username})`);
    res.json({ success: true, filename: cleanName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버에 파일을 저장하는 도중 오류가 발생했습니다.' });
  }
});

// 4. 파일 삭제 API (로그인 필요)
app.post('/api/files/delete', requireLogin, async (req, res) => {
  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ error: '파일명이 누락되었습니다.' });
  }

  const safeName = path.basename(filename);
  const username = req.session.user.username;
  const isAdmin = req.session.user.role === 'admin';

  try {
    // 권한 체크: DB에서 최초 작성자 조회
    const metaRes = await pool.query('SELECT creator FROM onlyoffice_documents WHERE filename = $1', [safeName]);
    const creator = metaRes.rows.length > 0 ? metaRes.rows[0].creator : null;

    // 작성자 본인 혹은 관리자만 삭제 가능
    if (creator && creator !== username && !isAdmin) {
      return res.status(403).json({ error: '최초 문서작성자 또는 관리자만 파일을 삭제할 수 있습니다.' });
    }

    // 실물 파일 찾기 및 삭제
    let deleted = false;
    let filePath = path.join(DOCUMENTS_DIR, safeName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      deleted = true;
    } else {
      if (fs.existsSync(PERSONAL_DIR)) {
        const users = fs.readdirSync(PERSONAL_DIR);
        for (const u of users) {
          const personalFilePath = path.join(PERSONAL_DIR, u, safeName);
          if (fs.existsSync(personalFilePath)) {
            fs.unlinkSync(personalFilePath);
            deleted = true;
            break;
          }
        }
      }
    }

    // DB 메타데이터 삭제
    await pool.query('DELETE FROM onlyoffice_documents WHERE filename = $1', [safeName]);

    if (!deleted) {
      return res.status(404).json({ error: '삭제할 실물 파일을 찾을 수 없습니다.' });
    }

    console.log(`파일 삭제 완료: ${safeName} (수행자: ${req.session.user.name})`);
    res.json({ success: true, message: '파일이 성공적으로 삭제되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '파일을 삭제하는 도중 오류가 발생했습니다.' });
  }
});

// 5. 문서 이동 API (공유 ↔ 개인)
app.post('/api/files/move', requireLogin, async (req, res) => {
  const { filename, sourceBox, targetBox } = req.body;
  if (!filename || !sourceBox || !targetBox) {
    return res.status(400).json({ error: '파일명 및 소스/타겟 문서함 정보가 누락되었습니다.' });
  }

  const safeName = path.basename(filename);
  const username = req.session.user.username;
  const isAdmin = req.session.user.role === 'admin';

  try {
    // 최초작성자 및 권한 검증
    const metaRes = await pool.query('SELECT creator FROM onlyoffice_documents WHERE filename = $1', [safeName]);
    if (metaRes.rows.length === 0) {
      return res.status(404).json({ error: '문서 메타데이터를 찾을 수 없습니다.' });
    }

    const creator = metaRes.rows[0].creator;

    // 본인 작성 문서 혹은 관리자만 이동 가능
    if (creator !== username && !isAdmin) {
      return res.status(403).json({ error: '최초 문서작성자 또는 관리자만 문서를 이동시킬 수 있습니다.' });
    }

    let sourcePath = '';
    let targetPath = '';

    if (sourceBox === 'personal' && targetBox === 'shared') {
      // 개인 -> 공유로 이동
      const personalDir = path.join(PERSONAL_DIR, creator);
      sourcePath = path.join(personalDir, safeName);

      if (!fs.existsSync(sourcePath)) {
        if (fs.existsSync(PERSONAL_DIR)) {
          const users = fs.readdirSync(PERSONAL_DIR);
          for (const u of users) {
            const tempPath = path.join(PERSONAL_DIR, u, safeName);
            if (fs.existsSync(tempPath)) {
              sourcePath = tempPath;
              break;
            }
          }
        }
      }

      targetPath = path.join(DOCUMENTS_DIR, safeName);
    } else if (sourceBox === 'shared' && targetBox === 'personal') {
      // 공유 -> 개인으로 이동 (작성자의 개인 문서함으로 전송)
      sourcePath = path.join(DOCUMENTS_DIR, safeName);

      const targetPersonalDir = path.join(PERSONAL_DIR, creator);
      if (!fs.existsSync(targetPersonalDir)) {
        fs.mkdirSync(targetPersonalDir, { recursive: true });
      }
      targetPath = path.join(targetPersonalDir, safeName);
    } else {
      return res.status(400).json({ error: '올바르지 않은 문서함 간 이동 요청입니다.' });
    }

    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: '이동할 실물 소스 파일을 찾을 수 없습니다.' });
    }

    if (fs.existsSync(targetPath)) {
      return res.status(400).json({ error: '대상 폴더에 동일한 이름의 파일이 이미 존재합니다.' });
    }

    fs.renameSync(sourcePath, targetPath);
    console.log(`문서 이동 완료 (${sourceBox} ➡️ ${targetBox}): ${safeName} (수행자: ${username})`);
    res.json({ success: true, message: '문서함 간 이동이 완료되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '문서 이동 처리 중 서버 오류가 발생했습니다.' });
  }
});

// 3. 개별 문서 파일 다운로드 API (ONLYOFFICE Docs는 컨테이너에서 접근하므로 세션검증 생략 가능하나 보안상 안전)
app.get('/documents/:filename', (req, res) => {
  const filename = req.params.filename;

  let filePath = path.join(DOCUMENTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(PERSONAL_DIR)) {
      const users = fs.readdirSync(PERSONAL_DIR);
      for (const u of users) {
        const tempPath = path.join(PERSONAL_DIR, u, filename);
        if (fs.existsSync(tempPath)) {
          filePath = tempPath;
          break;
        }
      }
    }
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('파일을 찾을 수 없습니다.');
  }

  res.sendFile(filePath);
});

// 4. ONLYOFFICE 콜백 핸들러
app.post('/api/track', async (req, res) => {
  const { status, url } = req.body;
  const filename = req.query.filename;

  console.log(`[ONLYOFFICE Callback] File: ${filename}, Status: ${status}`);

  if (status === 2 || status === 6) {
    if (!url) {
      console.error('[ONLYOFFICE Callback] 다운로드 URL이 누락되었습니다.');
      return res.json({ error: 1 });
    }

    try {
      // 저장 경로 결정 (공유함 또는 개인함 동적 탐색)
      let destPath = path.join(DOCUMENTS_DIR, filename);
      if (!fs.existsSync(destPath)) {
        if (fs.existsSync(PERSONAL_DIR)) {
          const users = fs.readdirSync(PERSONAL_DIR);
          for (const u of users) {
            const tempPath = path.join(PERSONAL_DIR, u, filename);
            if (fs.existsSync(tempPath)) {
              destPath = tempPath;
              break;
            }
          }
        }
      }

      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream'
      });

      const writer = fs.createWriteStream(destPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      console.log(`[ONLYOFFICE Callback] 파일 저장 성공 (저장 경로: ${destPath})`);
      return res.json({ error: 0 });
    } catch (err) {
      console.error('[ONLYOFFICE Callback] 파일 저장 중 오류 발생:', err.message);
      return res.json({ error: 1 });
    }
  }

  res.json({ error: 0 });
});

// 5. ONLYOFFICE 편집 설정 데이터 획득 API (로그인 계정과 문서 작성자 프로필 연동)
app.get('/api/config/:filename', requireLogin, (req, res) => {
  const filename = req.params.filename;

  let filePath = path.join(DOCUMENTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(PERSONAL_DIR)) {
      const users = fs.readdirSync(PERSONAL_DIR);
      for (const u of users) {
        const tempPath = path.join(PERSONAL_DIR, u, filename);
        if (fs.existsSync(tempPath)) {
          filePath = tempPath;
          break;
        }
      }
    }
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }

  const stats = fs.statSync(filePath);
  const key = getDocumentKey(filename, stats.mtime);

  let fileType = 'xlsx';
  let documentType = 'spreadsheet';

  if (filename.endsWith('.docx')) {
    fileType = 'docx';
    documentType = 'word';
  } else if (filename.endsWith('.pptx')) {
    fileType = 'pptx';
    documentType = 'slide';
  }

  const chatEnabled = req.query.chat === 'true';
  const currentUser = req.session.user; // 로그인한 세션 유저 정보 추출
  const isGuest = currentUser.username === 'guest';
  const mode = isGuest ? 'view' : 'edit';

  const config = {
    document: {
      fileType: fileType,
      key: key,
      title: filename,
      url: `${BACKEND_HOST}/documents/${encodeURIComponent(filename)}`,
      permissions: {
        edit: !isGuest,
        download: true
      }
    },
    documentType: documentType,
    editorConfig: {
      callbackUrl: `${BACKEND_HOST}/api/track?filename=${encodeURIComponent(filename)}`,
      lang: 'ko-KR',
      mode: mode,
      user: {
        id: currentUser.username, // 편집자를 고유한 로그인 아이디로 변경!
        name: currentUser.name // 편집자 실명 연동!
      },
      customization: {
        forcesave: true,
        chat: chatEnabled,
        comments: true,
        compactHeader: true,
        logo: {
          image: `${BACKEND_HOST}/dragon_logo.svg`,
          imageEmbedded: `${BACKEND_HOST}/dragon_logo.svg`,
          url: `${BACKEND_HOST}/index.html`
        }
      }
    }
  };

  res.json(config);
});

function getDocumentKey(filename, mtime) {
  const dateStr = new Date(mtime).getTime().toString();
  const cleanName = filename.replace(/[^a-zA-Z0-9]/g, '');
  return `${cleanName}_${dateStr}`;
}

initProject().then(() => {
  app.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`  프로젝트 문서관리 Backend Server is running!`);
    console.log(`  - Local Access URL: http://localhost:${PORT}`);
    console.log(`  - Configured ONLYOFFICE: ${ONLYOFFICE_SERVER}`);
    console.log(`  - Backend Host for ONLYOFFICE: ${BACKEND_HOST}`);
    console.log(`================================================================`);
  });
}).catch(err => {
  console.error('서버 초기화 중 심각한 오류 발생:', err);
});
