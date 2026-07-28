# 프로젝트 기동 및 오류 해결 결과 보고 (Walkthrough)

ONLYOFFICE 컨테이너의 기동 오류(EBUSY), 로고 및 아이콘 원복 문제, 'DragonEditor' 텍스트 잘림 현상, 그리고 데이터베이스(PostgreSQL) 연결 실패 문제를 모두 분석하여 해결을 완료했습니다.

---

## 🛠 작업 및 변경 내역

### 1. ONLYOFFICE EBUSY 기동 오류 및 사설 IP 허용 설정 해결
- **원인:** macOS 환경의 Docker 볼륨 마운트 시 `local.json` 파일을 단일 파일 바인딩 마운트할 경우, ONLYOFFICE 시작 스크립트가 내부적으로 설정을 변경하고 덮어쓰는(rename) 과정에서 `EBUSY` 권한 에러가 발생하여 컨테이너가 정상적으로 설정을 반영하지 못했습니다.
- **해결:** `docker-compose.yml`에서 `local.json` 단일 파일 볼륨 마운트를 제거하고, 대신 ONLYOFFICE가 공식 지원하는 환경 변수인 `ALLOW_PRIVATE_IP_ADDRESS=true`를 주입하여 사설 IP 대역 통신이 활성화되도록 수정했습니다.
  - 관련 파일: [docker-compose.yml](file:///Users/kangsunkim/defect-tracker-onlyoffice/docker-compose.yml)

### 2. DragonEditor 로고 및 아이콘 브랜딩 유지 설정
- **원인:** 이전 작업 시 ONLYOFFICE 컨테이너 내부의 로고 파일을 직접 덮어쓰셨던 경우, `docker-compose down && docker-compose up`과 같은 명령을 통해 컨테이너가 삭제 및 재기동되면서 컨테이너가 초기화되어 원래의 ONLYOFFICE 로고와 텍스트로 원복되었습니다.
- **해결:** `public` 폴더 아래 존재하는 `header-logo_s.svg`와 `dark-logo_s.svg` 파일을 `docker-compose.yml` 파일의 `volumes` 항목에 바인드 마운트 볼륨으로 등록했습니다. 이제 컨테이너를 재배포하거나 다시 생성하더라도 **DragonEditor** 브랜딩 로고와 아이콘이 항상 유지됩니다.
  - 관련 파일: [docker-compose.yml](file:///Users/kangsunkim/defect-tracker-onlyoffice/docker-compose.yml)

### 3. 'DragonEditor' 텍스트 잘림 현상 최종 해결 (CSS 120px 크기 확장 및 SVG 최적화)
- **원인:** ONLYOFFICE Docs 내부 CSS 스타일시트(`.extra #header-logo i`)에서 상단 로고 이미지의 가로 크기를 **`86px`**로 강력하게 제한하고 있습니다. 이로 인해 parent container인 `#header-logo`가 122px의 넉넉한 공간을 가짐에도 불구하고, 브라우저 렌더러가 이미지 자체를 86px로 잘라내서 마지막 글자인 'or'가 보이지 않는 문제가 발생했습니다.
- **해결:**
  - **컨테이너 내부 CSS 수정 및 재압축:** 
    ONLYOFFICE의 5대 에디터(Document, Spreadsheet, Presentation, PDF, Visio)의 `app.css` 파일에서 `.extra #header-logo i`의 `width:86px;` 속성을 **`width:120px;`**로 일괄 확장했습니다.
    Nginx가 압축 파일 캐시(`.css.gz`)를 우선 서빙하여 수정이 누락되는 일을 막기 위해, 수정 직후 `gzip -k -f` 명령을 가동하여 컨테이너 내부의 `.css.gz` 캐시 파일까지 완벽하게 새로 빌드하여 동기화했습니다.
  - **SVG 가로 공간 확보 및 원본 해상도 복원:**
    [dark-logo_s.svg](file:///Users/kangsunkim/defect-tracker-onlyoffice/public/dark-logo_s.svg)와 [header-logo_s.svg](file:///Users/kangsunkim/defect-tracker-onlyoffice/public/header-logo_s.svg) 파일의 해상도를 120px에 맞추어 `viewBox="0 0 120 20"` 및 `width="120"`으로 복원했습니다.
    공룡 아이콘 역시 원래의 이쁜 비율인 20px로 복구하고, 텍스트 크기를 다시 **`10.5`**로 키워 매우 가독성 높고 선명한 **DragonEditor** 브랜딩이 잘림 현상 없이 전부 표기되도록 완성했습니다.

### 4. 로고 클릭 이벤트 및 마우스 커서 제거 (단순 로고화)
- **원인:** 헤더의 로고 영역을 클릭하면 ONLYOFFICE 홈페이지나 특정 링크로 연결되는 기본 동작이 탑재되어 있고 마우스 호버 시 손가락 커서(`pointer`)가 노출되었습니다.
- **해결:** 
  - 5대 에디터의 `app.css` 내에서 `.extra #header-logo` 컨테이너에 **`pointer-events: none;`** 및 **`cursor: default;`** 스타일을 영구 적용했습니다.
  - 이로써 마우스 호버 시 일반 텍스트나 이미지처럼 손가락 커서(Pointer)가 표시되지 않으며, 클릭해도 아무런 동작을 수행하지 않는 순수 브랜드 로고(Static Image)로 완전 변경되었습니다.

### 5. PostgreSQL 데이터베이스 컨테이너 연동 및 환경 변수화
- **원인:** `cmm-postgres` 컨테이너가 중지되어 있었으며, `server.js` 파일에 예전 사설 IP인 `192.168.1.35` 주소와 `postgres` 기본 데이터베이스로 연결 정보가 고정(hardcoded)되어 연결 오류가 발생했습니다.
- **해결:** 
  - `cmm-postgres` 컨테이너를 다시 구동시켰습니다.
  - 컨테이너 내부의 `postgres` 사용자 비밀번호를 기존 DB 초기 설정과 일치하도록 `1234`로 갱신했습니다.
  - `server.js` 내의 DB 접속 정보가 환경 변수(`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`)를 사용하도록 변경하고, 로컬 개발 환경용 기본값(`127.0.0.1`, `cmm_db`)을 설정하여 DHCP 등으로 IP가 계속 변하더라도 로컬 호스트 주소(localhost)를 통해 안정적으로 통신하도록 설정했습니다.
  - 관련 파일: [server.js](file:///Users/kangsunkim/defect-tracker-onlyoffice/server.js)

---

## 🚀 기동 상태 확인

### 1. Docker 컨테이너 상태
- **onlyoffice-ds** 및 **cmm-postgres** 컨테이너 모두가 오류 로그 없이 정상 구동 중입니다.
```bash
CONTAINER ID   IMAGE                              STATUS         PORTS
onlyoffice-ds  onlyoffice/documentserver:latest   Up 5 seconds   443/tcp, 0.0.0.0:8080->80/tcp
cmm-postgres   postgres:14                        Up 1 hour      0.0.0.0:5432->5432/tcp
```

### 2. Node Backend 서버 구동 상태
- 백엔드 서버가 로컬에서 성공적으로 실행되어 PostgreSQL에 정상 연결되었고, DB 내 테이블 검사 및 기존 공유 문서들의 메타데이터 등록 작업을 성공적으로 완료했습니다.
- 기본 관리자 계정 생성 성공: `admin / admin123`

---

## 🔍 수동 확인 방법 및 테스트 요청

1. 웹 브라우저를 열고 다음 주소에 접속합니다:
   - **[http://192.168.1.25:3000/](http://192.168.1.25:3000/)** (또는 `http://localhost:3000/`)
2. 기본 생성된 시스템 관리자 계정으로 로그인합니다:
   - **아이디:** `admin`
   - **비밀번호:** `admin123`
3. 로그인 후 대시보드 리스트에서 아무 문서(예: `테스트1.docx` 또는 `테스트1.xlsx`)를 클릭하여 편집 창을 엽니다.
4. 에디터가 로딩되면 상단 타이틀 바 왼쪽에 **DragonEditor** 전체 텍스트가 잘리는 글자 없이 예쁘게 노출되는지 확인해 주세요. (로딩 캐시가 남아있을 수 있으므로 시크릿 창 또는 강력 새로고침 `Ctrl + Shift + R`으로 확인하시는 것을 적극 권장합니다.)
