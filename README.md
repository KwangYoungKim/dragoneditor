# DragonEditor & Defect Tracker

ONLYOFFICE Docs를 연동한 실시간 공동 문서 편집 플랫폼과 이슈 추적 백엔드 서버 프로젝트입니다.

---

## 📋 프로젝트 개요

이 프로젝트는 **ONLYOFFICE Document Server**를 브랜딩한 **DragonEditor**를 통해 웹 상에서 다양한 문서(`docx`, `xlsx`, `pptx` 등)를 실시간으로 열고 공동 편집할 수 있으며, Node.js 백엔드와 PostgreSQL 데이터베이스를 연동하여 결함 관리 및 사용자 문서를 제어할 수 있는 시스템입니다.

---

## 🛠 작업 환경 설정 방법 (Setup Guide)

### 1. 사전 요구사항 (Prerequisites)
- **Node.js**: v18 이상 권장
- **Docker & Docker Compose**: ONLYOFFICE 및 PostgreSQL 가동용
- **PostgreSQL Client**: DB 접속 확인용 (옵션)

### 2. 패키지 설치
로컬 워크스페이스 루트에서 백엔드 의존성 패키지를 설치합니다:
```bash
npm install
```

### 3. 데이터베이스 생성 및 권한 설정
PostgreSQL에 접속하여 다음과 같이 데이터베이스 및 권한을 설정합니다:
```sql
-- postgres 사용자의 비밀번호 설정
ALTER ROLE postgres PASSWORD '1234';

-- 프로젝트용 데이터베이스 생성
CREATE DATABASE cmm_db;
```

---

## 🚀 서버 시작 방법 (Running the Servers)

서버는 **데이터베이스(DB)**, **ONLYOFFICE 에디터**, **Node 백엔드 서버** 3가지가 모두 구동되어야 정상 동작합니다.

### 1. Docker 컨테이너 실행 (PostgreSQL & ONLYOFFICE)
프로젝트 루트 폴더에서 아래 명령어를 실행하여 Docker 컨테이너를 가동합니다:
```bash
# 컨테이너 백그라운드 실행
docker-compose up -d
```
* 컨테이너가 정상적으로 실행되면 아래 주소로 ONLYOFFICE Docs에 접근 가능합니다:
  * ONLYOFFICE Docs: `http://localhost:8080` (또는 `http://192.168.1.25:8080`)

### 2. Node 백엔드 서버 구동
서버 구동 시 ONLYOFFICE 및 프론트엔드가 백엔드 주소를 참조할 수 있도록 **`BACKEND_HOST` 환경 변수**를 사설 IP(혹은 localhost) 주소로 명시하여 실행합니다:
```bash
# 사설 IP 대역이 192.168.1.25인 경우
BACKEND_HOST=http://192.168.1.25:3000 npm start

# 로컬 단독 테스트 시
BACKEND_HOST=http://localhost:3000 npm start
```
* 백엔드 포트는 기본적으로 `3000`번 포트를 사용합니다.
* 서버가 정상 기동되면 DB 테이블이 없더라도 자동으로 스키마 및 초기 관리자 계정(`admin / admin123`)을 생성합니다.

---

## 📝 작업 및 변경 내역 (Changelog)

기존 기동 오류 및 브랜드 잘림 현상을 해결하기 위해 적용된 기술적 내역입니다.

### 1. ONLYOFFICE EBUSY 기동 오류 해결
- **문제:** Docker 볼륨 바인딩 시 `local.json` 파일을 단일 파일로 직접 마운트하여 기동 스크립트의 덮어쓰기 작업 도중 `EBUSY` 에러가 발생해 컨테이너가 정상 실행되지 않았습니다.
- **해결:** `local.json` 마운트를 해제하고, ONLYOFFICE가 공식 지원하는 환경 변수인 `ALLOW_PRIVATE_IP_ADDRESS=true` 옵션을 설정하여 영구적이고 안전하게 사설 IP 접근을 활성화했습니다.

### 2. DragonEditor 로고 브랜딩 영구 유지화
- **문제:** 컨테이너 내부의 로고 파일을 직접 수정하여 컨테이너 재기동(`docker-compose down && up`) 시 로고가 초기화되는 문제가 있었습니다.
- **해결:** `public` 내의 브랜드 SVG 로고 파일들을 `docker-compose.yml` 볼륨에 연동하여 컨테이너를 삭제하고 다시 띄우더라도 항상 **DragonEditor** 브랜딩이 유지되도록 구성했습니다.

### 3. 'DragonEditor' 텍스트 잘림 현상 해결 (CSS 가로 폭 확장 및 SVG 최적화)
- **문제:** ONLYOFFICE Docs 내부 CSS 스타일시트(`.extra #header-logo i`)의 로고 이미지 가로 크기가 `86px`로 하드코딩 고정되어 있어, 브라우저가 이미지의 우측을 잘라내어 "or" 글자가 보이지 않았습니다.
- **해결:**
  - **CSS 120px 확장:** 5대 에디터의 `app.css` 파일 내에서 `.extra #header-logo i`의 가로 제한 크기를 `120px`로 변경하여 가로 폭을 충분히 확보했습니다.
  - **Nginx Gzip 캐시 동기화:** 수정 사항이 Nginx 사전 압축 파일 서비스 캐시 정책에 걸려 반영되지 않는 문제를 피하기 위해, `.css` 수정과 동시에 `.css.gz` 압축 캐시 파일도 동기화하여 다시 빌드했습니다.
  - **SVG 해상도 복원:** SVG 캔버스 비율을 `viewBox="0 0 120 20"`으로 복구하고 글씨 폰트 크기를 가독성 높은 `10.5`로 쾌적하게 롤백했습니다.

### 4. 로고 클릭 차단 및 마우스 포인터 제거 (단순 로고화)
- **문제:** 헤더 로고를 클릭하면 ONLYOFFICE 공식 홈페이지로 이동하는 외부 링크와 손가락 포인터(`cursor: pointer`)가 노출되는 문제가 있었습니다.
- **해결:** CSS 파일 내 `#header-logo` 영역에 `pointer-events: none;` 및 `cursor: default;` 스타일을 강제 적용하여, 클릭 시 아무 행동도 하지 않고 일반 이미지처럼 동작하도록 마크업 이벤트를 무력화했습니다.

### 5. guest 사용자 계정 권한 제한 (조회 및 다운로드만 허용, 편집 불가)
- **문제:** 가입 승인된 모든 사용자(`guest` 포함)가 공유문서함의 문서를 편집 모드로 수정할 수 있어 불필요한 수정 가능성이 있었습니다.
- **해결:** `guest` 계정일 때 ONLYOFFICE 에디터의 실행 모드를 `view`로 고정하고, `permissions` 객체에서 `edit: false` 및 `download: true`를 주입하여 조회와 다운로드만 가능하게 처리했습니다.

### 6. 문서 사용 전용 폰트 일괄 다운로드 기능 제공 (ZIP 아카이브)
- **문제:** 에디터 내부에서 사용 중인 한글 폰트(`Pretendard`, `Freesentation` 등)를 클라이언트 로컬 컴퓨터에 가지고 있지 않은 사용자의 경우 폰트 매칭이 어긋날 수 있습니다.
- **해결:** `server.js`에 `/api/fonts/download` 엔드포인트를 신설하여 `fonts/` 폴더 내의 모든 `.ttf` 및 `.otf` 파일들을 동적으로 압축하여 `DragonEditor_Fonts.zip`으로 다운로드할 수 있게 하였고, 대시보드 메인 화면 상단에 보라색 **[폰트 다운로드]** 버튼을 노출했습니다.

### 7. PostgreSQL 연동 및 DB 주소 환경 변수화
- **문제:** 중지된 DB 컨테이너 복구와 함께, `server.js`에 이전 하드코딩된 사설 IP가 기재되어 DB 통신 실패 에러가 발생했습니다.
- **해결:** 비밀번호 재설정(`1234`)과 함께, `server.js` 파일이 IP를 고정하지 않고 `DB_HOST`, `DB_PORT`, `DB_NAME` 등의 환경 변수 환경에 유연하게 대처할 수 있도록 로직을 고도화했습니다.

---

## 🔍 수동 확인 방법 및 테스트 요청

1. 웹 브라우저를 열고 다음 주소에 접속합니다:
   - **[http://192.168.1.25:3000/](http://192.168.1.25:3000/)** (또는 `http://localhost:3000/`)
2. 로그인합니다:
   - **아이디:** `admin` / **비밀번호:** `admin123`
3. 대시보드에서 문서를 클릭하여 에디터를 열고, 왼쪽 상단의 **DragonEditor** 텍스트와 로고를 확인해 주세요. (캐시 삭제 필수: `Cmd + Shift + R` 혹은 시크릿 창 권장)
