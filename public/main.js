document.addEventListener('DOMContentLoaded', () => {
  // Lucide 아이콘 렌더링
  lucide.createIcons();

  const fileListContainer = document.getElementById('file-list-container');
  const totalFilesStat = document.getElementById('stat-total-files');
  const latestFileStat = document.getElementById('stat-latest-file');
  const btnCreateModal = document.getElementById('btn-create-modal');
  const createModal = document.getElementById('create-modal');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const btnModalConfirm = document.getElementById('btn-modal-confirm');
  const btnRefresh = document.getElementById('btn-refresh');
  const newFilenameInput = document.getElementById('new-filename');
  const newFiletypeSelect = document.getElementById('new-filetype');

  // 로그인 상태 및 사용자 정보 요소
  const userDisplayName = document.getElementById('user-display-name');
  const btnAdminPanel = document.getElementById('btn-admin-panel');
  const btnLogout = document.getElementById('btn-logout');

  // 파일 업로드 관련 요소
  const btnUploadTrigger = document.getElementById('btn-upload-trigger');
  const fileUploadInput = document.getElementById('file-upload-input');

  // 비밀번호 변경 관련 요소
  const btnPwdModalTrigger = document.getElementById('btn-pwd-modal-trigger');
  const passwordModal = document.getElementById('password-modal');
  const btnPwdCancel = document.getElementById('btn-pwd-cancel');
  const btnPwdConfirm = document.getElementById('btn-pwd-confirm');
  const pwdCurrentInput = document.getElementById('pwd-current');
  const pwdNewInput = document.getElementById('pwd-new');
  const pwdNewConfirmInput = document.getElementById('pwd-new-confirm');

  // 회원 탈퇴 관련 요소
  const btnWithdrawSelf = document.getElementById('btn-withdraw-self');

  // 문서함 탭 및 필터 관련 요소
  const tabShared = document.getElementById('tab-shared');
  const tabPersonal = document.getElementById('tab-personal');
  const adminUserFilterContainer = document.getElementById('admin-user-filter-container');
  const adminUserSelect = document.getElementById('admin-user-select');
  const panelTitleText = document.getElementById('panel-title-text');

  // 드래그 앤 드롭 업로드 오버레이 관련 요소
  const dashboardPanel = document.querySelector('.dashboard-panel');
  const dropZoneOverlay = document.getElementById('drop-zone-overlay');
  const dropZoneText = document.getElementById('drop-zone-text');

  // 전역 사용자 정보 보관용 변수
  let currentUserRole = '';
  let currentUsername = '';
  let currentBox = 'shared'; // 'shared' 또는 'personal'
  let isUserSelectPopulated = false; // 관리자용 유저 셀렉트가 채워졌는지 여부

  // 카드 이동 드래그 진행 상태 추적용 플래그
  window.isDraggingCard = false;

  // ==========================================
  // [인증 및 세션 체크 로직]
  // ==========================================
  async function checkAuthentication() {
    try {
      const response = await fetch('/api/auth/me');
      const data = await response.json();

      if (!data.loggedIn) {
        // 비로그인 상태인 경우 로그인 페이지로 강제 리다이렉트
        window.location.href = 'login.html';
        return;
      }

      // 전역 변수에 로그인 정보 보관
      currentUserRole = data.user.role;
      currentUsername = data.user.username;

      // 로그인된 사용자 정보 렌더링
      userDisplayName.textContent = `${data.user.name} 님`;
      
      // 관리자 권한일 경우 관리자 페이지 버튼 활성화
      if (data.user.role === 'admin') {
        btnAdminPanel.style.display = 'inline-flex';
      }

      // 화면 부드럽게 노출
      document.body.style.opacity = '1';

      // 파일 목록 로드 시작
      await loadFiles();
    } catch (err) {
      console.error('인증 체크 실패:', err);
      window.location.href = 'login.html';
    }
  }

  // 로그아웃 이벤트 처리
  btnLogout.addEventListener('click', async () => {
    if (!confirm('로그아웃 하시겠습니까?')) return;
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.ok) {
        window.location.href = 'login.html';
      } else {
        alert('로그아웃 실패');
      }
    } catch (err) {
      console.error(err);
      alert('로그아웃 처리 중 서버 에러가 발생했습니다.');
    }
  });

  // ==========================================
  // [비밀번호 변경 로직]
  // ==========================================
  if (btnPwdModalTrigger && passwordModal) {
    // 비밀번호 변경 모달 열기
    btnPwdModalTrigger.addEventListener('click', () => {
      passwordModal.classList.add('active');
      pwdCurrentInput.value = '';
      pwdNewInput.value = '';
      pwdNewConfirmInput.value = '';
      pwdCurrentInput.focus();
    });

    // 비밀번호 변경 모달 닫기
    const closePwdModal = () => {
      passwordModal.classList.remove('active');
    };
    btnPwdCancel.addEventListener('click', closePwdModal);

    // 비밀번호 변경 실행
    btnPwdConfirm.addEventListener('click', async () => {
      const currentPassword = pwdCurrentInput.value;
      const newPassword = pwdNewInput.value;
      const newConfirm = pwdNewConfirmInput.value;

      if (!currentPassword || !newPassword || !newConfirm) {
        alert('모든 입력란을 작성해 주세요.');
        return;
      }

      if (newPassword.length < 4) {
        alert('새 비밀번호는 최소 4자 이상이어야 합니다.');
        return;
      }

      if (newPassword !== newConfirm) {
        alert('새 비밀번호와 비밀번호 확인이 일치하지 않습니다.');
        return;
      }

      try {
        const response = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword })
        });

        const result = await response.json();
        if (response.ok && result.success) {
          alert('비밀번호가 성공적으로 변경되었습니다.');
          closePwdModal();
        } else {
          alert(result.error || '비밀번호 변경에 실패했습니다.');
        }
      } catch (err) {
        console.error(err);
        alert('서버 오류로 비밀번호를 변경하지 못했습니다.');
      }
    });

    // 엔터키 처리
    pwdNewConfirmInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        btnPwdConfirm.click();
      }
    });
  }

  // ==========================================
  // [회원 탈퇴 로직]
  // ==========================================
  if (btnWithdrawSelf) {
    btnWithdrawSelf.addEventListener('click', async () => {
      if (!confirm('정말로 회원 탈퇴 신청을 진행하시겠습니까?')) return;
      if (!confirm('탈퇴 신청 시 즉시 로그아웃되며, 관리자 승인 후 계정이 완전히 삭제됩니다. 진행하시겠습니까?')) return;

      try {
        const response = await fetch('/api/auth/withdraw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();
        if (response.ok && result.success) {
          alert('회원 탈퇴 신청이 정상 접수되었습니다. 이용해 주셔서 감사합니다.');
          window.location.href = 'login.html';
        } else {
          alert(result.error || '회원 탈퇴 신청 중 오류가 발생했습니다.');
        }
      } catch (err) {
        console.error(err);
        alert('서버 오류로 회원 탈퇴 신청을 완료하지 못했습니다.');
      }
    });
  }

  // ==========================================
  // [문서함 탭 전환 및 필터 로직]
  // ==========================================
  if (tabShared && tabPersonal) {
    // 1. 공유 문서함 탭 클릭
    tabShared.addEventListener('click', async () => {
      if (currentBox === 'shared') return;
      currentBox = 'shared';
      
      tabShared.classList.add('active');
      tabPersonal.classList.remove('active');
      
      if (adminUserFilterContainer) adminUserFilterContainer.style.display = 'none';
      if (panelTitleText) panelTitleText.textContent = '공유 문서 목록 (.xlsx, .docx, .pptx)';
      
      await loadFiles();
    });

    // 2. 개인 문서함 탭 클릭
    tabPersonal.addEventListener('click', async () => {
      if (currentBox === 'personal') return;
      currentBox = 'personal';
      
      tabPersonal.classList.add('active');
      tabShared.classList.remove('active');
      
      if (panelTitleText) panelTitleText.textContent = '개인 문서 목록 (.xlsx, .docx, .pptx)';
      
      // 관리자 권한인 경우에만 사용자 필터 활성화 및 데이터 주입
      if (currentUserRole === 'admin' && adminUserFilterContainer) {
        adminUserFilterContainer.style.display = 'inline-flex';
        if (!isUserSelectPopulated) {
          await populateAdminUserSelect();
        }
      }
      
      await loadFiles();
    });
  }

  // 관리자용 유저 셀렉트 변경 시 목록 갱신
  if (adminUserSelect) {
    adminUserSelect.addEventListener('change', async () => {
      await loadFiles();
    });
  }

  // 관리자용 회원 목록 콤보박스 주입 함수
  async function populateAdminUserSelect() {
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const users = await res.json();
        // 승인 완료된 유저 목록만 필터링해서 추가 (어드민 제외, 일반 유저 위주)
        const approvedUsers = users.filter(u => u.status === 'approved' && u.username !== 'admin');
        
        approvedUsers.forEach(user => {
          const opt = document.createElement('option');
          opt.value = user.username;
          opt.textContent = `${user.name} (${user.username})`;
          adminUserSelect.appendChild(opt);
        });
        isUserSelectPopulated = true;
      }
    } catch (err) {
      console.error('관리자 필터 회원 조회 오류:', err);
    }
  }

  // ==========================================
  // [문서 목록 및 관리 로직]
  // ==========================================

  // 파일 목록 로드 함수
  async function loadFiles() {
    fileListContainer.innerHTML = `
      <div class="empty-state">
        <i data-lucide="loader-2" class="spin" style="animation: spin 1s linear infinite; width: 36px; height: 36px;"></i>
        <p style="margin-top: 10px;">문서 목록을 불러오는 중입니다...</p>
      </div>
    `;
    lucide.createIcons();

    try {
      // 탭(shared/personal) 및 관리자 필터 조건 설정
      let url = `/api/files?box=${currentBox}`;
      if (currentBox === 'personal' && currentUserRole === 'admin') {
        const selectedUser = adminUserSelect ? adminUserSelect.value : 'all';
        url += `&targetUser=${selectedUser}`;
      }

      const response = await fetch(url);
      if (response.status === 401) {
        window.location.href = 'login.html';
        return;
      }
      const files = await response.json();

      if (files.length === 0) {
        fileListContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon"><i data-lucide="folder-open" style="width: 48px; height: 48px; stroke: #4b5563;"></i></div>
            <p>생성된 문서가 없습니다.</p>
            <p style="font-size: 13px; color: var(--text-secondary);">새로운 문서를 생성하거나 마우스 드래그로 파일을 이곳에 올려보세요!</p>
          </div>
        `;
        totalFilesStat.textContent = '0';
        latestFileStat.textContent = '-';
        lucide.createIcons();
        return;
      }

      totalFilesStat.textContent = files.length;
      latestFileStat.textContent = files[0].name.replace(/\.[^/.]+$/, ""); // 확장자 제거 표시
      latestFileStat.title = files[0].name;

      fileListContainer.innerHTML = '';
      files.forEach(file => {
        const card = document.createElement('div');
        card.className = 'file-card';

        const sizeStr = formatBytes(file.size);
        const dateStr = formatDate(file.mtime);

        // 확장자별 다른 아이콘 및 색상 매핑
        let iconName = 'file-spreadsheet';
        let iconColor = '#10b981'; // 기본 녹색 (Excel)
        let iconBg = 'rgba(16, 185, 129, 0.1)';

        if (file.name.endsWith('.docx')) {
          iconName = 'file-text';
          iconColor = '#3b82f6'; // 파란색 (Word)
          iconBg = 'rgba(59, 130, 246, 0.1)';
        } else if (file.name.endsWith('.pptx')) {
          iconName = 'presentation';
          iconColor = '#f97316'; // 주황색 (PowerPoint)
          iconBg = 'rgba(249, 115, 22, 0.1)';
        }

        // 이동 권한 및 버튼 설정 (최초작성자이거나 관리자인 경우 노출)
        const isCreator = file.creator === currentUsername;
        const isAdmin = currentUserRole === 'admin';
        const canMove = isCreator || isAdmin;

        // 드래그앤드롭을 이용한 문서함 이동 지원을 위해 draggable 속성 부여
        if (canMove) {
          card.setAttribute('draggable', 'true');
          
          card.addEventListener('dragstart', (e) => {
            const dragData = {
              filename: file.name,
              sourceBox: currentBox
            };
            e.dataTransfer.setData('application/json', JSON.stringify(dragData));
            e.dataTransfer.effectAllowed = 'move';
            card.style.opacity = '0.4';
            window.isDraggingCard = true; // 카드 이동 상태 지정
          });

          card.addEventListener('dragend', () => {
            card.style.opacity = '1';
            window.isDraggingCard = false; // 카드 이동 종료
            tabShared.classList.remove('drag-over');
            tabPersonal.classList.remove('drag-over');
          });
        }

        let moveBtnHtml = '';
        if (canMove) {
          if (currentBox === 'shared') {
            moveBtnHtml = `
              <button class="btn-action btn-move" data-file="${encodeURIComponent(file.name)}" data-action="to-personal" style="border-color: rgba(59, 130, 246, 0.4); color: #3b82f6;">
                개인함 이동
              </button>
            `;
          } else {
            moveBtnHtml = `
              <button class="btn-action btn-move" data-file="${encodeURIComponent(file.name)}" data-action="to-shared" style="border-color: rgba(16, 185, 129, 0.4); color: #10b981;">
                공유함 이동
              </button>
            `;
          }
        }

        // 삭제 권한 제어 (작성자 혹은 관리자만 빨간색 삭제 노출)
        const canDelete = isCreator || isAdmin;
        let deleteBtnHtml = '';
        if (canDelete) {
          deleteBtnHtml = `
            <button class="btn-action btn-delete" data-file="${encodeURIComponent(file.name)}" style="border-color: rgba(239, 68, 68, 0.4); color: #ef4444;">
              삭제
            </button>
          `;
        }

        // 정보 라벨 고도화 (작성자 표시, 관리자 필터 시 개인함 소유자 표시)
        const creatorLabel = `<span>작성자: ${escapeHtml(file.creator)}</span>`;
        const ownerLabel = (currentBox === 'personal' && isAdmin) ? `<span>개인함: ${escapeHtml(file.owner)}</span>` : '';

        // 제목 부분에 btn-title-open 클래스를 붙이고, 편집/보기 버튼은 제외
        card.innerHTML = `
          <div class="file-info">
            <div class="file-icon" style="background: ${iconBg}; color: ${iconColor};">
              <i data-lucide="${iconName}"></i>
            </div>
            <div class="file-details">
              <div class="file-name btn-title-open" data-file="${encodeURIComponent(file.name)}" title="편집/보기">${escapeHtml(file.name)}</div>
              <div class="file-meta">
                <span>크기: ${sizeStr}</span>
                <span>최종 수정: ${dateStr}</span>
                ${creatorLabel}
                ${ownerLabel}
              </div>
            </div>
          </div>
          <div class="file-actions" style="display: flex; gap: 8px;">
            ${moveBtnHtml}
            ${deleteBtnHtml}
          </div>
        `;
        fileListContainer.appendChild(card);
      });

      // 문서 제목 클릭 시 에디터 로드 이벤트 핸들러 등록
      document.querySelectorAll('.btn-title-open').forEach(titleEl => {
        titleEl.addEventListener('click', (e) => {
          const filename = e.target.getAttribute('data-file');
          window.location.href = `editor.html?filename=${filename}&chat=true`;
        });
      });

      // 문서 삭제 이벤트 핸들러 등록
      document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const filename = decodeURIComponent(e.target.getAttribute('data-file'));
          if (!confirm(`[${filename}] 파일을 정말로 삭제하시겠습니까?\n삭제된 파일은 복구할 수 없습니다.`)) return;

          try {
            const response = await fetch('/api/files/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename })
            });

            const result = await response.json();
            if (response.ok && result.success) {
              alert('파일이 성공적으로 삭제되었습니다.');
              await loadFiles();
            } else {
              alert(result.error || '파일 삭제 중 오류가 발생했습니다.');
            }
          } catch (err) {
            console.error(err);
            alert('서버 오류로 파일을 삭제하지 못했습니다.');
          }
        });
      });

      // 문서 이동 이벤트 핸들러 등록
      document.querySelectorAll('.btn-move').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const filename = decodeURIComponent(e.target.getAttribute('data-file'));
          const direction = e.target.getAttribute('data-action');
          
          let sourceBox = 'shared';
          let targetBox = 'personal';
          let directionText = '개인 문서함';

          if (direction === 'to-shared') {
            sourceBox = 'personal';
            targetBox = 'shared';
            directionText = '공유 문서함';
          }

          if (!confirm(`[${filename}] 파일을 [${directionText}]으로 이동시키겠습니까?`)) return;

          try {
            const response = await fetch('/api/files/move', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename, sourceBox, targetBox })
            });

            const result = await response.json();
            if (response.ok && result.success) {
              alert('문서함 이동이 완료되었습니다.');
              await loadFiles();
            } else {
              alert(result.error || '문서 이동 중 실패했습니다.');
            }
          } catch (err) {
            console.error(err);
            alert('서버 통신 중 오류가 발생했습니다.');
          }
        });
      });

      lucide.createIcons();
    } catch (err) {
      console.error(err);
      fileListContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" style="color: #ef4444;"><i data-lucide="alert-triangle"></i></div>
          <p>서버와 통신하는 도중 오류가 발생했습니다.</p>
          <p style="font-size: 13px; color: var(--text-secondary);">백엔드 서버와 ONLYOFFICE 컨테이너 실행 상태를 확인해 주세요.</p>
        </div>
      `;
      lucide.createIcons();
    }
  }

  // ==========================================
  // [문서함 간 드래그 앤 드롭 파일 이동 기능 구현]
  // ==========================================
  function registerTabDropEvents(tabElement, targetBoxName) {
    tabElement.addEventListener('dragover', (e) => {
      if (window.isDraggingCard && currentBox !== targetBoxName) {
        e.preventDefault();
        tabElement.classList.add('drag-over');
      }
    });

    tabElement.addEventListener('dragenter', (e) => {
      if (window.isDraggingCard && currentBox !== targetBoxName) {
        e.preventDefault();
        tabElement.classList.add('drag-over');
      }
    });

    tabElement.addEventListener('dragleave', () => {
      tabElement.classList.remove('drag-over');
    });

    tabElement.addEventListener('drop', async (e) => {
      tabElement.classList.remove('drag-over');
      if (!window.isDraggingCard) return;
      e.preventDefault();

      try {
        const dragData = JSON.parse(e.dataTransfer.getData('application/json'));
        if (dragData.sourceBox === targetBoxName) return;

        const filename = dragData.filename;
        const sourceBox = dragData.sourceBox;
        const targetBox = targetBoxName;
        const directionText = targetBox === 'shared' ? '공유 문서함' : '개인 문서함';

        if (!confirm(`[${filename}] 파일을 [${directionText}]으로 이동시키겠습니까?`)) return;

        const response = await fetch('/api/files/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, sourceBox, targetBox })
        });

        const result = await response.json();
        if (response.ok && result.success) {
          alert('문서함 이동이 완료되었습니다.');
          await loadFiles();
        } else {
          alert(result.error || '문서 이동 중 실패했습니다.');
        }
      } catch (err) {
        console.error(err);
        alert('문서 이동 중 오류가 발생했습니다.');
      }
    });
  }

  // 양방향 탭 드롭 이벤트 활성화
  if (tabShared && tabPersonal) {
    registerTabDropEvents(tabShared, 'shared');
    registerTabDropEvents(tabPersonal, 'personal');
  }

  // ==========================================
  // [로컬 파일 드래그 앤 드롭 업로드 기능 구현]
  // ==========================================
  if (dashboardPanel && dropZoneOverlay) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dashboardPanel.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    // 드래그 진입 오버레이 노출 (카드 드래그 이동 시에는 작동 제외)
    ['dragenter', 'dragover'].forEach(eventName => {
      dashboardPanel.addEventListener(eventName, (e) => {
        if (window.isDraggingCard) return; // 카드 드래그 시에는 업로드 영역 표시 안 함
        
        dropZoneOverlay.style.display = 'flex';
        const boxName = currentBox === 'shared' ? '공유 문서함' : '개인 문서함';
        dropZoneText.textContent = `여기에 파일을 놓아 [${boxName}]으로 업로드`;
      }, false);
    });

    // 드래그 이탈 오버레이 숨김
    dashboardPanel.addEventListener('dragleave', (e) => {
      const rect = dashboardPanel.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
        dropZoneOverlay.style.display = 'none';
      }
    }, false);

    // 드롭 성공 시 파일 업로드 처리
    dashboardPanel.addEventListener('drop', (e) => {
      dropZoneOverlay.style.display = 'none';
      if (window.isDraggingCard) return; // 카드 이동 드롭일 경우 제외

      const dt = e.dataTransfer;
      const files = dt.files;

      if (files && files.length > 0) {
        handleDroppedLocalFiles(files);
      }
    }, false);
  }

  // 로컬 드롭 파일 데이터 백엔드 전송
  async function handleDroppedLocalFiles(files) {
    const file = files[0];
    if (!file) return;

    const allowedExts = ['.xlsx', '.docx', '.pptx'];
    const fileExt = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedExts.includes(fileExt)) {
      alert('허용되지 않는 파일 형식입니다. (.xlsx, .docx, .pptx만 업로드 가능)');
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      alert('업로드할 수 있는 최대 파일 크기는 500MB입니다.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target.result.split(',')[1];
      
      try {
        if (dropZoneOverlay) {
          dropZoneOverlay.style.display = 'flex';
          dropZoneText.innerHTML = '<i data-lucide="loader-2" class="spin" style="animation: spin 1s linear infinite; width: 24px; height: 24px; color: #3b82f6;"></i> 업로드 중...';
          lucide.createIcons();
        }

        const response = await fetch('/api/files/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, base64: base64Data, box: currentBox })
        });

        const result = await response.json();
        if (response.ok && result.success) {
          alert(`[${file.name}] 파일이 성공적으로 업로드되었습니다.`);
          await loadFiles();
        } else {
          alert(result.error || '파일 업로드 중 오류가 발생했습니다.');
        }
      } catch (err) {
        console.error(err);
        alert('서버 통신 실패로 파일을 업로드하지 못했습니다.');
      } finally {
        if (dropZoneOverlay) {
          dropZoneOverlay.style.display = 'none';
        }
      }
    };
    reader.readAsDataURL(file);
  }

  // ==========================================
  // [모달 및 수동 업로드 제어]
  // ==========================================

  // 모달 열기/닫기 이벤트
  btnCreateModal.addEventListener('click', () => {
    createModal.classList.add('active');
    newFilenameInput.value = '';
    newFilenameInput.focus();
  });

  const closeModal = () => {
    createModal.classList.remove('active');
  };

  btnModalCancel.addEventListener('click', closeModal);

  // 문서 생성 확인
  btnModalConfirm.addEventListener('click', async () => {
    const filename = newFilenameInput.value.trim();
    const type = newFiletypeSelect.value; // 'cell', 'word', 'slide'
    
    if (!filename) {
      alert('파일 이름을 입력해 주세요.');
      return;
    }

    try {
      const response = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, type, box: currentBox }) // 활성화된 문서함 경로 전달
      });

      const result = await response.json();
      if (response.ok && result.success) {
        closeModal();
        await loadFiles();
      } else {
        alert(result.error || '파일 생성 중 오류가 발생했습니다.');
      }
    } catch (err) {
      console.error(err);
      alert('서버 오류로 파일을 생성하지 못했습니다.');
    }
  });

  // 파일 업로드 동작 구현 (수동 버튼 클릭)
  if (btnUploadTrigger && fileUploadInput) {
    btnUploadTrigger.addEventListener('click', () => {
      fileUploadInput.click();
    });

    fileUploadInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const allowedExts = ['.xlsx', '.docx', '.pptx'];
      const fileExt = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!allowedExts.includes(fileExt)) {
        alert('허용되지 않는 파일 형식입니다. (.xlsx, .docx, .pptx만 업로드 가능)');
        fileUploadInput.value = '';
        return;
      }

      // 500MB 크기 제한
      if (file.size > 500 * 1024 * 1024) {
        alert('업로드할 수 있는 최대 파일 크기는 500MB입니다.');
        fileUploadInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target.result.split(',')[1];
        
        try {
          btnUploadTrigger.disabled = true;
          btnUploadTrigger.innerHTML = '<i data-lucide="loader-2" class="spin" style="animation: spin 1s linear infinite; width: 14px; height: 14px;"></i> 불러오는 중...';
          lucide.createIcons();

          const response = await fetch('/api/files/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, base64: base64Data, box: currentBox })
          });

          const result = await response.json();
          if (response.ok && result.success) {
            alert('파일이 성공적으로 로드되었습니다.');
            await loadFiles();
          } else {
            alert(result.error || '파일 업로드 중 오류가 발생했습니다.');
          }
        } catch (err) {
          console.error(err);
          alert('서버 통신 실패로 파일을 업로드하지 못했습니다.');
        } finally {
          btnUploadTrigger.disabled = false;
          btnUploadTrigger.innerHTML = '<i data-lucide="upload" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 4px;"></i> 로컬 파일 불러오기';
          fileUploadInput.value = '';
          lucide.createIcons();
        }
      };
      reader.readAsDataURL(file);
    });
  }

  newFilenameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnModalConfirm.click();
    }
  });

  btnRefresh.addEventListener('click', loadFiles);

  // 파일 크기 포맷팅 함수
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // 날짜 포맷팅 함수
  function formatDate(dateString) {
    const date = new Date(dateString);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
  }

  // HTML 이스케이프 함수
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // 최초 페이지 기동 시 로그인 상태 점검 실행
  checkAuthentication();
});
