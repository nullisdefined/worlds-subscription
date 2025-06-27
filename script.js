// 환경 감지 및 설정값들
const isLocalhost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const isFileProtocol = window.location.protocol === "file:";

// 환경별 설정
let API_BASE_URL, LOGIN_API_URL, SUBSCRIPTION_API_URL, REDIRECT_URI;

if (isLocalhost || isFileProtocol) {
  // 로컬 환경 (Live Server 사용)
  API_BASE_URL =
    "https://vpmjzf8rn8.execute-api.ap-northeast-2.amazonaws.com/prod";
  LOGIN_API_URL = API_BASE_URL + "/login";
  SUBSCRIPTION_API_URL = API_BASE_URL + "/subscribe";
  REDIRECT_URI = "http://localhost:5500/"; // Live Server 포트
  console.log("Development Environment");
} else {
  // 배포 환경
  API_BASE_URL =
    window.ENV?.API_BASE_URL ||
    "https://vpmjzf8rn8.execute-api.ap-northeast-2.amazonaws.com/prod";
  LOGIN_API_URL = API_BASE_URL + "/login";
  SUBSCRIPTION_API_URL = API_BASE_URL + "/subscribe";
  REDIRECT_URI = window.location.origin + "/worlds-subscription/";
}

const KAKAO_APP_KEY =
  window.ENV?.KAKAO_APP_KEY || "a5460d517f8aa1e9209b8fbcb0b5408f";

let selectedLanguages = ["english"];
let currentUser = null;
let authSession = null;

// 세션 관리 클래스
class AuthSession {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
    this.userInfo = null;
  }

  static fromStorage() {
    const sessionData = localStorage.getItem("authSession");
    if (sessionData) {
      try {
        const data = JSON.parse(sessionData);
        const session = new AuthSession();
        session.accessToken = data.accessToken;
        session.refreshToken = data.refreshToken;
        session.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
        session.userInfo = data.userInfo;
        return session;
      } catch (e) {
        console.error("Error parsing session data:", e);
        localStorage.removeItem("authSession");
      }
    }
    return null;
  }

  saveToStorage() {
    const sessionData = {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt ? this.expiresAt.toISOString() : null,
      userInfo: this.userInfo,
    };
    localStorage.setItem("authSession", JSON.stringify(sessionData));
  }

  clear() {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
    this.userInfo = null;
    localStorage.removeItem("authSession");
    localStorage.removeItem("currentUser"); // 기존 저장 데이터도 정리
  }

  isValid() {
    if (!this.accessToken) return false;
    if (!this.expiresAt) return true; // 만료 시간이 없으면 유효하다고 가정
    return new Date() < this.expiresAt;
  }

  needsRefresh() {
    if (!this.expiresAt) return false;
    // 만료 10분 전에 갱신
    const refreshTime = new Date(this.expiresAt.getTime() - 10 * 60 * 1000);
    return new Date() > refreshTime;
  }
}

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
  initializeApp();
  setupLanguageCards();

  // Lucide 아이콘 초기화
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
});

async function initializeApp() {
  console.log("앱 초기화 중...");

  // 기존 세션 복원
  authSession = AuthSession.fromStorage();

  if (authSession) {
    console.log("기존 세션 발견:", authSession.userInfo);

    // 토큰 유효성 확인
    if (authSession.isValid()) {
      if (authSession.needsRefresh()) {
        console.log("토큰 갱신 필요");
        await refreshAuthToken();
      }

      // 세션 유효성 재확인
      const isSessionValid = await checkSession();
      if (isSessionValid) {
        updateUIForLoggedInUser();
        return;
      }
    }

    // 유효하지 않은 세션 정리
    console.log("유효하지 않은 세션 정리");
    authSession.clear();
    authSession = null;
  }

  // OAuth 콜백 처리
  const urlParams = new URLSearchParams(window.location.search);
  const authCode = urlParams.get("code");
  const error = urlParams.get("error");

  if (error) {
    handleOAuthError(error, urlParams.get("error_description"));
    return;
  }

  if (authCode) {
    console.log("OAuth 콜백 처리 중...");
    await handleLoginCallback(authCode);
  }
}

function setupEventListeners() {
  // 로그인 관련
  if (loginBtn) loginBtn.addEventListener("click", openLoginModal);
  if (kakaoLoginBtn) kakaoLoginBtn.addEventListener("click", handleKakaoLogin);
  if (closeModal) closeModal.addEventListener("click", closeLoginModal);
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  // 사용자 메뉴 버튼 클릭 이벤트 추가
  const userMenuBtn = document.getElementById("userMenuBtn");
  if (userMenuBtn) {
    userMenuBtn.addEventListener("click", toggleDropdown);
  }

  // 모달 배경 클릭 시 닫기
  window.addEventListener("click", (e) => {
    const userDropdown = document.getElementById("userDropdown");
    // 드롭다운 외부 클릭 시 닫기
    if (userDropdown && !userDropdown.contains(e.target)) {
      userDropdown.classList.remove("active");
    }

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

  // 구독 취소
  const unsubscribeBtn = document.getElementById("unsubscribeBtn");
  if (unsubscribeBtn) {
    unsubscribeBtn.addEventListener("click", handleUnsubscribe);
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
  const channelUrl = "http://pf.kakao.com/_xnzTxin/friend";
  const popup = window.open(
    channelUrl,
    "kakaoChannel",
    "width=400,height=500,scrollbars=yes"
  );

  if (!popup) {
    return;
  }

  const checkClosed = setInterval(() => {
    if (popup.closed) {
      clearInterval(checkClosed);
      closeChannelNotification();
    }
  }, 1000);
}

function subscribeService() {
  if (selectedLanguages.length === 0) {
    showResult("언어를 최소 1개 이상 선택해주세요!", "error");
    return;
  }

  // 로그인 확인
  if (!currentUser) {
    showChannelNotification();
    return;
  }

  // 이미 구독된 사용자면 구독 업데이트
  if (currentUser.isSubscribed) {
    updateSubscription();
  } else {
    createSubscription();
  }
}

async function createSubscription() {
  try {
    showProcessingModal("구독 처리 중...");

    const response = await fetch(SUBSCRIPTION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "subscribe",
        user_id: currentUser.id,
        nickname: currentUser.nickname,
        email: currentUser.email,
        profile_image: currentUser.profileImage,
        languages: selectedLanguages,
      }),
    });

    const data = await response.json();
    hideProcessingModal();

    if (data.success) {
      // 사용자 정보 업데이트
      currentUser.isSubscribed = true;
      currentUser.languages = data.languages;
      currentUser.subscriptionStatus = data.subscription_status;
      currentUser.subscriptionDate = data.subscription_date;

      // 세션 정보도 업데이트
      if (authSession) {
        authSession.userInfo = currentUser;
        authSession.saveToStorage();
      }

      updateUIForLoggedInUser();
      showResult(`🎉 ${data.nickname}님, 구독이 완료되었습니다!`, "success");
    } else {
      showResult(data.error || "구독 처리에 실패했습니다.", "error");
    }
  } catch (error) {
    console.error("구독 처리 오류:", error);
    hideProcessingModal();
    showResult("구독 처리 중 오류가 발생했습니다.", "error");
  }
}

async function updateSubscription() {
  try {
    showProcessingModal("구독 정보 업데이트 중...");

    const response = await fetch(SUBSCRIPTION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "update_subscription",
        user_id: currentUser.id,
        languages: selectedLanguages,
      }),
    });

    const data = await response.json();
    hideProcessingModal();

    if (data.success) {
      // 사용자 정보 업데이트
      currentUser.languages = data.languages;

      // 세션 정보도 업데이트
      if (authSession) {
        authSession.userInfo = currentUser;
        authSession.saveToStorage();
      }

      updateUIForLoggedInUser();
      showResult("구독 정보가 업데이트되었습니다!", "success");
    } else {
      showResult(data.error || "구독 업데이트에 실패했습니다.", "error");
    }
  } catch (error) {
    console.error("구독 업데이트 오류:", error);
    hideProcessingModal();
    showResult("구독 업데이트 중 오류가 발생했습니다.", "error");
  }
}

function showChannelNotification() {
  const modal = document.getElementById("channelNotificationModal");
  if (modal) {
    modal.style.display = "flex";
  }
}

function closeChannelNotification() {
  const modal = document.getElementById("channelNotificationModal");
  if (modal) {
    modal.style.display = "none";
  }

  // 로그인하지 않은 사용자면 로그인 처리
  if (!currentUser) {
    proceedWithLogin();
  } else {
    // 이미 로그인된 사용자면 바로 구독 처리
    subscribeService();
  }
}

function proceedWithLogin() {
  // 선택한 언어 정보를 세션에 저장
  sessionStorage.setItem(
    "selectedLanguages",
    JSON.stringify(selectedLanguages)
  );

  // 카카오 로그인으로 이동
  handleLoginClick();
}

function showMessageModal(message) {
  const modal = document.getElementById("messageModal");
  const messageText = document.getElementById("messageText");

  if (modal && messageText) {
    messageText.textContent = message;
    modal.style.display = "flex";
  }
}

function closeMessageModal() {
  const modal = document.getElementById("messageModal");
  if (modal) {
    modal.style.display = "none";
  }
}

function showErrorModal(message) {
  const modal = document.getElementById("errorModal");
  const errorText = document.getElementById("errorText");

  if (modal && errorText) {
    errorText.textContent = message;
    modal.style.display = "flex";

    // 3초 후 자동으로 숨기기
    setTimeout(() => {
      modal.style.display = "none";
    }, 3000);
  }
}

function showProcessingModal(message = "처리 중...") {
  const modal = document.getElementById("processingModal");
  const processingText = document.getElementById("processingText");

  if (modal && processingText) {
    processingText.textContent = message;
    modal.style.display = "flex";
  }
}

function hideProcessingModal() {
  const modal = document.getElementById("processingModal");
  if (modal) {
    modal.style.display = "none";
  }
}

function showResult(message, type) {
  if (type === "success") {
    showMessageModal(message);
  } else if (type === "error") {
    showErrorModal(message);
  } else {
    showProcessingModal(message);
  }
}

function showLoading() {
  showProcessingModal("로딩 중...");
}

function hideLoading() {
  hideProcessingModal();
}

function toggleDropdown() {
  const userDropdown = document.getElementById("userDropdown");
  if (userDropdown) {
    userDropdown.classList.toggle("active");
  }
}

// 로그인 처리
function handleLoginClick() {
  console.log("로그인 버튼 클릭");
  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_APP_KEY}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code`;

  console.log("카카오 로그인 페이지로 리다이렉트:", kakaoAuthUrl);
  window.location.href = kakaoAuthUrl;
}

async function handleLoginCallback(authCode) {
  try {
    showProcessingModal("로그인 처리 중...");

    const response = await fetch(LOGIN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "login",
        code: authCode,
      }),
    });

    const data = await response.json();
    hideProcessingModal();

    if (data.success) {
      // 새로운 세션 생성
      authSession = new AuthSession();
      authSession.accessToken = data.access_token;
      authSession.refreshToken = data.refresh_token || null;
      authSession.expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;
      authSession.userInfo = {
        id: data.user_id,
        nickname: data.nickname,
        email: data.email,
        profileImage: data.profile_image,
        isSubscribed: data.is_subscribed,
        languages: data.selected_languages || [],
        subscriptionStatus: data.subscription_status,
        subscriptionDate: data.subscription_date,
      };

      // 세션 저장
      authSession.saveToStorage();

      // 현재 사용자 정보 설정
      currentUser = authSession.userInfo;

      // UI 업데이트
      updateUIForLoggedInUser();

      // URL 정리
      window.history.replaceState({}, document.title, window.location.pathname);

      showResult(`🎉 ${data.nickname}님, 로그인이 완료되었습니다!`, "success");
    } else {
      showResult(data.error || "로그인에 실패했습니다.", "error");
    }
  } catch (error) {
    console.error("로그인 콜백 처리 오류:", error);
    hideProcessingModal();
    showResult("로그인 처리 중 오류가 발생했습니다.", "error");
  }
}

async function checkSession() {
  if (!authSession || !authSession.accessToken) {
    return false;
  }

  try {
    const response = await fetch(LOGIN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "check_session",
        access_token: authSession.accessToken,
      }),
    });

    const data = await response.json();
    return data.success && data.valid;
  } catch (error) {
    console.error("세션 확인 오류:", error);
    return false;
  }
}

async function refreshAuthToken() {
  if (!authSession || !authSession.refreshToken) {
    return false;
  }

  try {
    const response = await fetch(LOGIN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "refresh",
        refresh_token: authSession.refreshToken,
      }),
    });

    const data = await response.json();

    if (data.success) {
      authSession.accessToken = data.access_token;
      authSession.expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;
      authSession.saveToStorage();
      return true;
    }
  } catch (error) {
    console.error("토큰 갱신 오류:", error);
  }

  return false;
}

function handleOAuthError(error, errorDescription) {
  console.error("OAuth Error:", error, errorDescription);

  let userMessage = "로그인 중 오류가 발생했습니다.";

  if (error === "access_denied") {
    userMessage = "로그인이 취소되었습니다.";
  } else if (error === "invalid_request") {
    userMessage = "잘못된 로그인 요청입니다. 다시 시도해주세요.";
  } else if (error === "server_error") {
    userMessage =
      "카카오 서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
  }

  showResult(userMessage, "error");
  window.history.replaceState({}, document.title, window.location.pathname);
}

// 로그인된 사용자 UI 업데이트
function updateUIForLoggedInUser() {
  if (!currentUser) return;

  console.log("로그인된 사용자 UI 업데이트:", currentUser);

  // 네비게이션 업데이트 - 로그인 버튼 숨기고 드롭다운 표시
  if (loginBtn) {
    loginBtn.style.display = "none";
  }

  // 사용자 드롭다운 표시
  const userDropdown = document.getElementById("userDropdown");
  const userNickname = document.getElementById("userNickname");
  const userAvatar = document.getElementById("userAvatar");

  if (userDropdown) {
    userDropdown.style.display = "block";
  }

  if (userNickname) {
    userNickname.textContent = `${currentUser.nickname}님`;
  }

  if (userAvatar) {
    userAvatar.src =
      currentUser.profileImage ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23667eea'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
  }

  // 구독된 사용자인 경우 사용자 정보 표시
  if (currentUser.isSubscribed) {
    if (userInfo) {
      userInfo.style.display = "block";
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
      if (currentUser.subscriptionDate) {
        const subscriptionDate = new Date(currentUser.subscriptionDate);
        const today = new Date();
        const diffTime = Math.abs(today - subscriptionDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        userEmailEl.textContent = `함께한 지 ${diffDays}일째 🎉`;
      } else {
        userEmailEl.textContent = "함께한 지 1일째 🎉";
      }
    }

    if (userProfileEl) {
      userProfileEl.src =
        currentUser.profileImage ||
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23667eea'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
    }

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

    // 구독 버튼 비활성화 및 텍스트 변경
    const subscribeBtn = document.querySelector(".subscribe-btn");
    if (subscribeBtn) {
      subscribeBtn.innerHTML = "구독 관리에서 언어를 변경하세요";
      subscribeBtn.classList.add("disabled");
      subscribeBtn.onclick = () => {
        showMessageModal("구독 관리 버튼을 통해 언어를 변경할 수 있습니다.");
      };
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
}

// 로그아웃
async function handleLogout() {
  try {
    // API에 로그아웃 요청
    if (authSession && authSession.accessToken) {
      await fetch(LOGIN_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "logout",
          access_token: authSession.accessToken,
        }),
      });
    }
  } catch (error) {
    console.error("로그아웃 API 호출 오류:", error);
  }

  // 로컬 세션 정리
  if (authSession) {
    authSession.clear();
  }
  authSession = null;
  currentUser = null;

  // UI 초기화
  if (loginBtn) {
    loginBtn.style.display = "block";
    loginBtn.textContent = "로그인";
    loginBtn.classList.remove("btn-primary");
    loginBtn.classList.add("btn-outline");
  }

  // 사용자 드롭다운 숨기기
  const userDropdown = document.getElementById("userDropdown");
  if (userDropdown) {
    userDropdown.style.display = "none";
    userDropdown.classList.remove("active");
  }

  if (userInfo) {
    userInfo.style.display = "none";
  }

  // 언어 카드 활성화
  document.querySelectorAll(".language-card").forEach((card) => {
    card.classList.remove("disabled");
  });

  // 구독 버튼 원상복구
  const subscribeBtn = document.querySelector(".subscribe-btn");
  if (subscribeBtn) {
    subscribeBtn.classList.remove("disabled");
    subscribeBtn.onclick = subscribeService;
    updateSubscribeButton();
  }

  showResult("로그아웃이 완료되었습니다.", "success");
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

  // 구독 버튼 활성화 및 텍스트 변경
  const subscribeBtn = document.querySelector(".subscribe-btn");
  if (subscribeBtn) {
    subscribeBtn.innerHTML = "📱 언어 설정 변경하기";
    subscribeBtn.classList.remove("disabled");
    subscribeBtn.onclick = subscribeService;
  }
}

// 구독 취소 처리
async function handleUnsubscribe() {
  if (!currentUser) {
    showResult("로그인이 필요합니다.", "error");
    return;
  }

  if (!confirm("정말로 구독을 취소하시겠습니까?")) {
    return;
  }

  try {
    showProcessingModal("구독 취소 처리 중...");

    const response = await fetch(SUBSCRIPTION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "unsubscribe",
        user_id: currentUser.id,
      }),
    });

    const data = await response.json();
    hideProcessingModal();

    if (data.success) {
      // 사용자 정보 업데이트
      currentUser.isSubscribed = false;
      currentUser.subscriptionStatus = "inactive";

      // 세션 정보도 업데이트
      if (authSession) {
        authSession.userInfo = currentUser;
        authSession.saveToStorage();
      }

      // UI 초기화
      if (userInfo) {
        userInfo.style.display = "none";
      }

      // 언어 카드 활성화
      document.querySelectorAll(".language-card").forEach((card) => {
        card.classList.remove("disabled");
      });

      // 구독 버튼 원상복구
      const subscribeBtn = document.querySelector(".subscribe-btn");
      if (subscribeBtn) {
        subscribeBtn.classList.remove("disabled");
        subscribeBtn.onclick = subscribeService;
        updateSubscribeButton();
      }

      showResult("구독이 취소되었습니다.", "success");
    } else {
      showResult(data.error || "구독 취소에 실패했습니다.", "error");
    }
  } catch (error) {
    console.error("구독 취소 오류:", error);
    hideProcessingModal();
    showResult("구독 취소 중 오류가 발생했습니다.", "error");
  }
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

// API 함수들
async function getUserInfo(userId) {
  try {
    const response = await fetch(`${API_BASE_URL}/user/${userId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("사용자를 찾을 수 없습니다");
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("API 응답 데이터:", data);
    return data;
  } catch (error) {
    console.error("사용자 정보 조회 실패:", error);
    throw error;
  }
}

async function unsubscribeUser(userId) {
  try {
    const response = await fetch(`${API_BASE_URL}/unsubscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("구독 취소 실패:", error);
    throw error;
  }
}
