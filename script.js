// 환경 감지 및 설정값들
const isLocalhost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const isFileProtocol = window.location.protocol === "file:";

// 환경별 설정
let API_URL, REDIRECT_URI;

if (isLocalhost || isFileProtocol) {
  // 로컬 환경 (Live Server 사용)
  API_URL =
    "https://vpmjzf8rn8.execute-api.ap-northeast-2.amazonaws.com/prod/subscribe";
  REDIRECT_URI = "http://localhost:5500/"; // Live Server 포트
  console.log("Development Environment");
} else {
  // 배포 환경
  API_URL =
    window.ENV?.API_URL ||
    "https://vpmjzf8rn8.execute-api.ap-northeast-2.amazonaws.com/prod/subscribe";
  REDIRECT_URI = window.location.origin + "/worlds-subscription/";
  //   console.log("Production Environment");
}

const KAKAO_APP_KEY =
  window.ENV?.KAKAO_APP_KEY || "a5460d517f8aa1e9209b8fbcb0b5408f";

let selectedLanguages = ["english"];
let currentUser = null;

// DOM 요소들
const loginBtn = document.getElementById("loginBtn");
const subscribeBtn = document.getElementById("subscribeBtn");
const loginModal = document.getElementById("loginModal");
const kakaoLoginBtn = document.getElementById("kakaoLoginBtn");
const closeModal = document.querySelector(".close");
const userInfo = document.getElementById("userInfo");
const logoutBtn = document.getElementById("logoutBtn");

// 이벤트 리스너 설정
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  checkLoginStatus();
  setupLanguageCards();

  // Lucide 아이콘 초기화
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
});

function setupEventListeners() {
  // 로그인 관련
  if (loginBtn) loginBtn.addEventListener("click", openLoginModal);
  if (kakaoLoginBtn) kakaoLoginBtn.addEventListener("click", handleKakaoLogin);
  if (closeModal) closeModal.addEventListener("click", closeLoginModal);
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  // 모달 배경 클릭 시 닫기
  window.addEventListener("click", (e) => {
    if (e.target === loginModal) {
      closeLoginModal();
    }

    // 채널 알림 모달 배경 클릭 시 닫기
    const channelModal = document.getElementById("channelNotificationModal");
    if (e.target === channelModal) {
      closeChannelNotification();
    }

    // 안내 메시지 모달 배경 클릭 시 닫기
    const messageModal = document.getElementById("messageModal");
    if (e.target === messageModal) {
      closeMessageModal();
    }
  });

  // 구독 관리
  const manageBtn = document.getElementById("manageSubscription");
  if (manageBtn) {
    manageBtn.addEventListener("click", showSubscriptionManagement);
  }
}

function setupLanguageCards() {
  // 언어 선택 처리
  document.querySelectorAll(".language-card").forEach((card) => {
    card.addEventListener("click", function () {
      // 로그인된 상태이고 카드가 비활성화된 경우 클릭 무시
      if (currentUser && this.classList.contains("disabled")) {
        showMessageModal("언어 설정을 변경하려면 구독 관리 버튼을 눌러주세요.");
        return;
      }

      const language = this.dataset.language;

      if (this.classList.contains("selected")) {
        // 선택 해제 (단, 최소 1개는 선택되어야 함)
        if (selectedLanguages.length > 1) {
          this.classList.remove("selected");
          selectedLanguages = selectedLanguages.filter((l) => l !== language);
        }
      } else {
        // 선택
        this.classList.add("selected");
        if (!selectedLanguages.includes(language)) {
          selectedLanguages.push(language);
        }
      }

      updateSubscribeButton();
    });
  });

  updateSubscribeButton();
}

function updateSubscribeButton() {
  const btn = document.querySelector(".subscribe-btn");
  if (btn) {
    if (selectedLanguages.length > 0) {
      btn.disabled = false;
      const languageNames = {
        english: "영어",
        chinese: "중국어",
        japanese: "일본어",
      };
      const names = selectedLanguages
        .map((lang) => languageNames[lang])
        .join(", ");
      btn.innerHTML = `${names} 구독하기`;
    } else {
      btn.disabled = true;
      btn.innerHTML = "언어를 선택해주세요";
    }
  }
}

function scrollToLanguages() {
  const languagesSection = document.getElementById("languages");
  if (languagesSection) {
    languagesSection.scrollIntoView({
      behavior: "smooth",
    });
  }
}

// 카카오톡 채널 친구추가
function addKakaoChannel() {
  // 카카오톡 채널 친구추가 URL
  const channelUrl = "http://pf.kakao.com/_xnzTxin/friend";

  // 새 창으로 채널 페이지 열기
  const popup = window.open(
    channelUrl,
    "kakaoChannel",
    "width=400,height=500,scrollbars=yes"
  );

  if (!popup) {
    // 팝업이 차단된 경우 바로 리턴
    return;
  }

  // 팝업 닫힘 감지 (친구추가 완료 후)
  const checkClosed = setInterval(() => {
    if (popup.closed) {
      clearInterval(checkClosed);
      // 친구추가 완료 후 모달 닫기
      closeChannelNotification();
    }
  }, 1000);
}

function subscribeService() {
  if (selectedLanguages.length === 0) {
    showResult("언어를 최소 1개 이상 선택해주세요!", "error");
    return;
  }

  // 채널 친구추가 알림 모달 표시
  showChannelNotification();
}

// 채널 알림 모달 표시
function showChannelNotification() {
  const modal = document.getElementById("channelNotificationModal");
  modal.classList.add("show");
}

// 채널 알림 모달 닫기
function closeChannelNotification() {
  const modal = document.getElementById("channelNotificationModal");
  modal.classList.remove("show");

  // 친구추가 완료 후 바로 구독 진행
  setTimeout(() => {
    proceedWithSubscription();
  }, 300);
}

// 안내 메시지 모달 표시
function showMessageModal(message) {
  const modal = document.getElementById("messageModal");
  const messageText = document.getElementById("messageText");
  messageText.textContent = message;
  modal.classList.add("show");
}

// 안내 메시지 모달 닫기
function closeMessageModal() {
  const modal = document.getElementById("messageModal");
  modal.classList.remove("show");
}

// 에러 모달 표시 (자동으로 사라짐)
function showErrorModal(message) {
  const modal = document.getElementById("errorModal");
  const errorText = document.getElementById("errorText");
  errorText.textContent = message;
  modal.classList.add("show");

  // 3.5초 후 자동으로 모달 닫기
  setTimeout(() => {
    modal.classList.remove("show");
  }, 3500);
}

// 처리중 모달 표시
function showProcessingModal(message = "처리 중...") {
  const modal = document.getElementById("processingModal");
  const processingText = document.getElementById("processingText");
  processingText.textContent = message;
  modal.classList.add("show");
}

// 처리중 모달 닫기
function hideProcessingModal() {
  const modal = document.getElementById("processingModal");
  modal.classList.remove("show");
}

// 구독 진행
function proceedWithSubscription() {
  if (!currentUser) {
    openLoginModal();
    return;
  }

  // 이미 로그인된 경우 바로 구독 처리
  processSubscription();
}

// 로그인 상태 확인 함수
function checkLoginStatus() {
  console.log("로그인 상태 확인 중...");

  // 저장된 사용자 정보 복원
  const savedUser = localStorage.getItem("currentUser");
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      console.log("저장된 사용자 정보 복원:", currentUser);
      updateUIForLoggedInUser();
      return; // 로그인된 상태이면 OAuth 처리 건너뛰기
    } catch (e) {
      console.error("저장된 사용자 정보 파싱 오류:", e);
      localStorage.removeItem("currentUser");
    }
  }

  // URL에서 인증 코드 확인
  const urlParams = new URLSearchParams(window.location.search);
  const authCode = urlParams.get("code");
  const error = urlParams.get("error");
  const errorDescription = urlParams.get("error_description");

  console.log("URL 파라미터:", { authCode, error, errorDescription });

  if (error) {
    console.error("Kakao OAuth Error:", error, errorDescription);

    // 카카오 OAuth 에러를 사용자 친화적으로 변환
    let userMessage = "로그인 중 오류가 발생했습니다.";

    if (error === "access_denied") {
      userMessage = "로그인이 취소되었습니다.";
    } else if (error === "invalid_request") {
      userMessage = "잘못된 로그인 요청입니다. 다시 시도해주세요.";
    } else if (error === "server_error") {
      userMessage =
        "카카오 서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
    } else if (errorDescription && errorDescription.includes("Redirect URI")) {
      userMessage = "페이지 설정에 문제가 있습니다. 관리자에게 문의해주세요.";
    } else {
      userMessage = "카카오 로그인에 실패했습니다. 다시 시도해주세요.";
    }

    showResult(userMessage, "error");
    // URL 정리
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  if (authCode) {
    console.log("Authorization code received:", authCode);
    console.log("현재 URL:", window.location.href);
    console.log("REDIRECT_URI:", REDIRECT_URI);

    // 카카오 콜백 처리 중 로딩 표시
    showLoading();
    handleSubscriptionCallback(authCode);
  }
}

// 구독 처리 함수
function processSubscription() {
  showResult("구독 처리 중...", "info");

  // 선택한 언어 정보를 세션에 저장
  sessionStorage.setItem(
    "selectedLanguages",
    JSON.stringify(selectedLanguages)
  );

  // 카카오 인증 URL 생성 시 state 파라미터 추가
  const state = Math.random().toString(36).substring(2, 15);
  sessionStorage.setItem("kakao_state", state);

  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_APP_KEY}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&state=${state}`;

  console.log("Redirecting to:", kakaoAuthUrl);
  window.location.href = kakaoAuthUrl;
}

// 구독 콜백 처리 함수
function handleSubscriptionCallback(authCode) {
  // state 검증
  const urlParams = new URLSearchParams(window.location.search);
  const returnedState = urlParams.get("state");
  const savedState = sessionStorage.getItem("kakao_state");

  if (returnedState !== savedState) {
    showResult(
      "로그인 보안 검증에 실패했습니다. 처음부터 다시 시도해주세요.",
      "error"
    );
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  // 세션에서 선택한 언어 정보 복원
  const savedLanguages = sessionStorage.getItem("selectedLanguages");
  if (savedLanguages) {
    selectedLanguages = JSON.parse(savedLanguages);
    // UI 업데이트
    selectedLanguages.forEach((lang) => {
      const card = document.querySelector(`[data-language="${lang}"]`);
      if (card) card.classList.add("selected");
    });
    updateSubscribeButton();
  }

  // 구독 처리 API 호출
  showResult("로그인 처리 중...", "info");

  const requestBody = {
    action: "subscribe",
    code: authCode,
    languages: selectedLanguages,
    redirect_uri: REDIRECT_URI, // 리다이렉트 URI도 함께 전송
  };

  console.log("Sending subscription request:", requestBody);
  console.log("API_URL:", API_URL);
  console.log("Headers:", {
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(requestBody),
  })
    .then(async (response) => {
      console.log("Response status:", response.status);
      console.log("Response headers:", response.headers);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Error response body:", errorText);

        // 사용자 친화적인 에러 메시지 생성
        let userMessage = "구독 처리 중 오류가 발생했습니다.";

        if (response.status === 400) {
          userMessage = "잘못된 요청입니다. 다시 시도해주세요.";
        } else if (response.status === 401) {
          userMessage =
            "카카오 로그인 인증에 실패했습니다. 다시 로그인해주세요.";
        } else if (response.status === 403) {
          userMessage = "접근 권한이 없습니다. 잠시 후 다시 시도해주세요.";
        } else if (response.status === 500) {
          userMessage =
            "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
        } else if (response.status >= 500) {
          userMessage = "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
        }

        throw new Error(userMessage);
      }
      return response.json();
    })
    .then((data) => {
      console.log("Subscription response:", data);

      // 로딩 해제
      hideLoading();

      if (data.success) {
        // 사용자 정보 저장
        const userData = {
          id: data.user_id,
          nickname: data.nickname || "사용자",
          email: data.email || "",
          languages: selectedLanguages,
          subscriptionDate: new Date().toISOString(),
        };

        localStorage.setItem("currentUser", JSON.stringify(userData));
        currentUser = userData;

        // UI 업데이트
        updateUIForLoggedInUser();

        // 성공 메시지 표시
        showResult(`🎉 ${data.nickname}님, 구독이 완료되었습니다!`, "success");

        // URL 정리 및 세션 정리
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );
        sessionStorage.removeItem("selectedLanguages");
        sessionStorage.removeItem("kakao_state");

        // 사용자 정보 섹션으로 스크롤
        setTimeout(() => {
          if (userInfo) {
            userInfo.scrollIntoView({ behavior: "smooth" });
          }
        }, 1000);
      } else {
        // 서버에서 받은 에러 메시지를 사용자 친화적으로 변환
        let errorMessage = "구독 처리에 실패했습니다.";

        if (data.error) {
          const error = data.error.toLowerCase();
          if (error.includes("token") || error.includes("access")) {
            errorMessage =
              "카카오 로그인 정보가 만료되었습니다. 다시 로그인해주세요.";
          } else if (error.includes("invalid") || error.includes("failed")) {
            errorMessage = "입력 정보가 올바르지 않습니다. 다시 시도해주세요.";
          } else if (error.includes("duplicate") || error.includes("already")) {
            errorMessage = "이미 구독되어 있습니다.";
          } else {
            errorMessage =
              "구독 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
          }
        }

        showResult(errorMessage, "error");
      }
    })
    .catch((error) => {
      console.error("Subscription error:", error);

      // 로딩 해제
      hideLoading();

      // 네트워크 오류나 기타 예외 처리
      let errorMessage = error.message;

      // 네트워크 오류 처리
      if (
        error.message.includes("Failed to fetch") ||
        error.message.includes("NetworkError")
      ) {
        errorMessage = "인터넷 연결을 확인하고 다시 시도해주세요.";
      } else if (error.message.includes("timeout")) {
        errorMessage = "요청 시간이 초과되었습니다. 다시 시도해주세요.";
      }

      showResult(errorMessage, "error");

      // URL 정리
      window.history.replaceState({}, document.title, window.location.pathname);
    });
}

// 카카오 로그인
function handleKakaoLogin() {
  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_APP_KEY}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code`;
  window.location.href = kakaoAuthUrl;
}

// 로그인된 사용자 UI 업데이트
function updateUIForLoggedInUser() {
  if (!currentUser) return;

  console.log("로그인된 사용자 UI 업데이트:", currentUser);

  // 네비게이션 업데이트 - 로그인 버튼을 닉네임으로 변경
  if (loginBtn) {
    loginBtn.textContent = `${currentUser.nickname}님`;
    loginBtn.classList.remove("btn-outline");
    loginBtn.classList.add("btn-primary");
    // 기존 이벤트 리스너 제거
    loginBtn.removeEventListener("click", openLoginModal);
    // 새로운 이벤트 리스너 추가
    loginBtn.onclick = (e) => {
      e.preventDefault();
      const userInfoSection = document.getElementById("userInfo");
      if (userInfoSection) {
        userInfoSection.scrollIntoView({ behavior: "smooth" });
      }
    };
  }

  // 사용자 정보 표시
  if (userInfo) {
    userInfo.style.display = "block";
    console.log("사용자 정보 섹션 표시됨");
  }

  const userNameEl = document.getElementById("userName");
  const userEmailEl = document.getElementById("userEmail");
  const userProfileEl = document.getElementById("userProfile");
  const subscriptionStatusEl = document.getElementById("subscriptionStatus");
  const selectedLanguagesEl = document.getElementById("selectedLanguages");
  const subscriptionDateEl = document.getElementById("subscriptionDate");

  if (userNameEl) {
    userNameEl.textContent = `${currentUser.nickname}님, 안녕하세요!`;
  }

  if (userEmailEl) {
    userEmailEl.textContent = currentUser.email || "이메일 정보 없음";
  }

  // 프로필 이미지 (기본 이미지 사용)
  if (userProfileEl) {
    userProfileEl.src =
      currentUser.profileImage ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23667eea'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
  }

  // 구독 정보 업데이트
  if (subscriptionStatusEl) {
    subscriptionStatusEl.textContent = "✅ 활성";
    subscriptionStatusEl.style.color = "#10b981";
  }

  if (
    currentUser.languages &&
    currentUser.languages.length > 0 &&
    selectedLanguagesEl
  ) {
    const languageNames = {
      english: "🇺🇸 영어",
      chinese: "🇨🇳 중국어",
      japanese: "🇯🇵 일본어",
    };
    const names = currentUser.languages
      .map((lang) => languageNames[lang] || lang)
      .join(", ");
    selectedLanguagesEl.textContent = names;
  }

  if (currentUser.subscriptionDate && subscriptionDateEl) {
    const date = new Date(currentUser.subscriptionDate);
    subscriptionDateEl.textContent = date.toLocaleDateString("ko-KR");
  }

  // 구독 버튼 텍스트 변경
  const subscribeBtn = document.querySelector(".subscribe-btn");
  if (subscribeBtn) {
    subscribeBtn.innerHTML = "✨ 언어 설정 변경하기";
  }

  // 언어 카드를 사용자의 구독 언어로 설정하고 비활성화
  if (currentUser.languages) {
    // 모든 카드 초기화
    document.querySelectorAll(".language-card").forEach((card) => {
      card.classList.remove("selected");
      card.classList.add("disabled");
    });

    // 사용자 구독 언어만 선택 상태로 설정
    currentUser.languages.forEach((lang) => {
      const card = document.querySelector(`[data-language="${lang}"]`);
      if (card) {
        card.classList.add("selected");
      }
    });

    // selectedLanguages 배열도 업데이트
    selectedLanguages = [...currentUser.languages];
    updateSubscribeButton();
  }
}

// 구독 관리
function showSubscriptionManagement() {
  // 언어 카드 활성화
  enableLanguageSelection();

  // 언어 선택 섹션으로 스크롤
  const languagesSection = document.getElementById("languages");
  if (languagesSection) {
    languagesSection.scrollIntoView({ behavior: "smooth" });
  }

  showMessageModal("언어를 다시 선택하고 구독하기 버튼을 눌러주세요.");
}

// 언어 선택 활성화
function enableLanguageSelection() {
  document.querySelectorAll(".language-card").forEach((card) => {
    card.classList.remove("disabled");
  });

  // 구독 버튼 텍스트 변경
  const subscribeBtn = document.querySelector(".subscribe-btn");
  if (subscribeBtn) {
    subscribeBtn.innerHTML = "📱 언어 설정 변경하기";
  }
}

// 로그아웃
function handleLogout() {
  localStorage.removeItem("currentUser");
  currentUser = null;

  // UI 초기화
  if (loginBtn) {
    loginBtn.textContent = "로그인";
    loginBtn.classList.remove("btn-primary");
    loginBtn.classList.add("btn-outline");
    // 기존 onclick 제거하고 이벤트 리스너로 다시 설정
    loginBtn.onclick = null;
    loginBtn.addEventListener("click", openLoginModal);
  }
  if (userInfo) {
    userInfo.style.display = "none";
  }

  // 언어 카드 선택 초기화
  document.querySelectorAll(".language-card").forEach((card) => {
    card.classList.remove("selected", "disabled");
  });
  document
    .querySelector('[data-language="english"]')
    ?.classList.add("selected");
  selectedLanguages = ["english"];

  // 구독 버튼 복원
  updateSubscribeButton();

  showResult("로그아웃되었습니다.", "info");
}

// 모달 관련
function openLoginModal() {
  if (loginModal) {
    loginModal.style.display = "block";
  }
}

function closeLoginModal() {
  if (loginModal) {
    loginModal.style.display = "none";
  }
}

// 결과 메시지 표시
function showResult(message, type) {
  // 에러 타입인 경우 에러 모달 사용
  if (type === "error") {
    showErrorModal(message);
    return;
  }

  // info 타입이고 "처리 중" 관련 메시지인 경우 처리중 모달 사용
  if (
    type === "info" &&
    (message.includes("처리 중") ||
      message.includes("구독 처리") ||
      message.includes("로그인"))
  ) {
    showProcessingModal(message);
    return;
  }

  // 기존 방식 유지 (success 등)
  const result = document.getElementById("result");
  if (result) {
    result.textContent = message;
    result.className = type;
    result.style.display = "block";

    // 자동 숨김
    setTimeout(() => {
      result.style.display = "none";
    }, 5000);

    // 메시지 위치로 스크롤
    result.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// 로딩 표시
function showLoading() {
  showProcessingModal("처리 중...");
}

// 로딩 숨김
function hideLoading() {
  hideProcessingModal();
}
