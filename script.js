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

  // 현재 포트 동적 감지
  const currentPort = window.location.port || "5500";
  REDIRECT_URI = `http://localhost:${currentPort}/`;

  console.log("Development Environment");
  console.log("감지된 포트:", currentPort);
  console.log("REDIRECT_URI:", REDIRECT_URI);
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
let selectedTimezone = "09:00"; // 기본값
let selectedDifficulty = "basic"; // 기본값
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

    // 세션 스토리지에서 인증 관련 데이터만 정리
    const sessionKeysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (
        key &&
        (key.includes("auth") || key.includes("user") || key.includes("token"))
      ) {
        sessionKeysToRemove.push(key);
      }
    }
    sessionKeysToRemove.forEach((key) => sessionStorage.removeItem(key));
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
const subscriptionConfirmModal = document.getElementById(
  "subscriptionConfirmModal"
);
const confirmSubscriptionBtn = document.getElementById("confirmSubscription");
const cancelSubscriptionBtn = document.getElementById("cancelSubscription");

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

  if (authSession && authSession.userInfo) {
    console.log("기존 세션 발견:", authSession.userInfo);

    // currentUser 설정
    currentUser = authSession.userInfo;

    // 로컬 환경에서는 세션 체크 생략 (API 호출 없이 바로 로그인 상태 유지)
    if (isLocalhost || isFileProtocol) {
      console.log("로컬 환경 - 세션 유지");
      updateUIForLoggedInUser();
      return;
    }

    // 토큰 유효성 확인 (배포 환경에서만)
    if (authSession.isValid()) {
      if (authSession.needsRefresh()) {
        console.log("토큰 갱신 필요");
        const refreshSuccess = await refreshAuthToken();
        if (!refreshSuccess) {
          console.log("토큰 갱신 실패 - 세션 정리");
          authSession.clear();
          authSession = null;
          currentUser = null;
        }
      }

      if (authSession) {
        updateUIForLoggedInUser();
        return;
      }
    } else {
      // 유효하지 않은 세션 정리
      console.log("유효하지 않은 세션 정리");
      authSession.clear();
      authSession = null;
      currentUser = null;
    }
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

  // 구독 확인 모달 관련
  if (confirmSubscriptionBtn)
    confirmSubscriptionBtn.addEventListener("click", proceedWithSubscription);
  if (cancelSubscriptionBtn)
    cancelSubscriptionBtn.addEventListener(
      "click",
      closeSubscriptionConfirmModal
    );

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

    if (e.target === subscriptionConfirmModal) {
      closeSubscriptionConfirmModal();
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

    // 시간 변경 모달 배경 클릭 시 닫기
    const timeChangeModal = document.getElementById("timeChangeModal");
    if (e.target === timeChangeModal) {
      closeTimeChangeModal();
    }

    // 난이도 변경 모달 배경 클릭 시 닫기
    const difficultyChangeModal = document.getElementById(
      "difficultyChangeModal"
    );
    if (e.target === difficultyChangeModal) {
      closeDifficultyChangeModal();
    }

    // 구독중지 모달 배경 클릭 시 닫기
    const unsubscribeModal = document.getElementById("unsubscribeModal");
    if (e.target === unsubscribeModal) {
      closeUnsubscribeModal();
    }

    // 회원탈퇴 모달 배경 클릭 시 닫기
    const deleteAccountModal = document.getElementById("deleteAccountModal");
    if (e.target === deleteAccountModal) {
      closeDeleteAccountModal();
    }

    // 신규 가입자 언어 선택 결과 모달 배경 클릭 시 닫기
    const languageSelectedModal = document.getElementById(
      "languageSelectedModal"
    );
    if (e.target === languageSelectedModal) {
      closeLanguageSelectedModal();
    }

    // 신규 가입자 시간대 설정 모달 배경 클릭 시 닫기
    const newUserTimeModal = document.getElementById("newUserTimeModal");
    if (e.target === newUserTimeModal) {
      closeNewUserTimeModal();
    }

    // 신규 가입자 난이도 설정 모달 배경 클릭 시 닫기
    const newUserDifficultyModal = document.getElementById(
      "newUserDifficultyModal"
    );
    if (e.target === newUserDifficultyModal) {
      closeNewUserDifficultyModal();
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

  // 드롭다운 메뉴의 구독 취소 버튼
  const unsubscribeMenuBtn = document.getElementById("unsubscribeMenuBtn");
  if (unsubscribeMenuBtn) {
    unsubscribeMenuBtn.addEventListener("click", handleUnsubscribe);
  }

  // 회원탈퇴 버튼
  const deleteAccountBtn = document.getElementById("deleteAccountBtn");
  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener("click", handleDeleteAccount);
  }

  // 시간 변경 버튼
  const changeTimeBtn = document.getElementById("changeTimeBtn");
  if (changeTimeBtn) {
    changeTimeBtn.addEventListener("click", showTimeChangeModal);
  }

  // 시간 변경 모달 버튼들
  const confirmTimeChangeBtn = document.getElementById("confirmTimeChange");
  const cancelTimeChangeBtn = document.getElementById("cancelTimeChange");
  if (confirmTimeChangeBtn) {
    confirmTimeChangeBtn.addEventListener("click", handleTimeChange);
  }
  if (cancelTimeChangeBtn) {
    cancelTimeChangeBtn.addEventListener("click", closeTimeChangeModal);
  }

  // 난이도 변경 버튼
  const changeDifficultyBtn = document.getElementById("changeDifficultyBtn");
  if (changeDifficultyBtn) {
    changeDifficultyBtn.addEventListener("click", showDifficultyChangeModal);
  }

  // 난이도 변경 모달 버튼들
  const confirmDifficultyChangeBtn = document.getElementById(
    "confirmDifficultyChange"
  );
  const cancelDifficultyChangeBtn = document.getElementById(
    "cancelDifficultyChange"
  );
  if (confirmDifficultyChangeBtn) {
    confirmDifficultyChangeBtn.addEventListener(
      "click",
      handleDifficultyChange
    );
  }
  if (cancelDifficultyChangeBtn) {
    cancelDifficultyChangeBtn.addEventListener(
      "click",
      closeDifficultyChangeModal
    );
  }

  // 구독중지 모달 버튼들
  const confirmUnsubscribeBtn = document.getElementById("confirmUnsubscribe");
  const cancelUnsubscribeBtn = document.getElementById("cancelUnsubscribe");
  if (confirmUnsubscribeBtn) {
    confirmUnsubscribeBtn.addEventListener("click", confirmUnsubscribe);
  }
  if (cancelUnsubscribeBtn) {
    cancelUnsubscribeBtn.addEventListener("click", closeUnsubscribeModal);
  }

  // 회원탈퇴 모달 버튼들
  const confirmDeleteAccountBtn = document.getElementById(
    "confirmDeleteAccount"
  );
  const cancelDeleteAccountBtn = document.getElementById("cancelDeleteAccount");
  if (confirmDeleteAccountBtn) {
    confirmDeleteAccountBtn.addEventListener("click", confirmDeleteAccount);
  }
  if (cancelDeleteAccountBtn) {
    cancelDeleteAccountBtn.addEventListener("click", closeDeleteAccountModal);
  }

  // 신규 가입자 언어 선택 결과 모달 버튼들
  const backToLanguageSelectionBtn = document.getElementById(
    "backToLanguageSelection"
  );
  const proceedToTimeSelectionBtn = document.getElementById(
    "proceedToTimeSelection"
  );
  if (backToLanguageSelectionBtn) {
    backToLanguageSelectionBtn.addEventListener(
      "click",
      backToLanguageSelection
    );
  }
  if (proceedToTimeSelectionBtn) {
    proceedToTimeSelectionBtn.addEventListener("click", proceedToTimeSelection);
  }

  // 신규 가입자 시간대 설정 모달 버튼들
  const cancelNewUserTimeBtn = document.getElementById("cancelNewUserTime");
  const confirmNewUserTimeBtn = document.getElementById("confirmNewUserTime");
  if (cancelNewUserTimeBtn) {
    cancelNewUserTimeBtn.addEventListener("click", () => {
      closeNewUserTimeModal();
      showLanguageSelectedModal();
    });
  }
  if (confirmNewUserTimeBtn) {
    confirmNewUserTimeBtn.addEventListener("click", proceedToNewUserDifficulty);
  }

  // 신규 가입자 난이도 설정 모달 버튼들
  const cancelNewUserDifficultyBtn = document.getElementById(
    "cancelNewUserDifficulty"
  );
  const confirmNewUserDifficultyBtn = document.getElementById(
    "confirmNewUserDifficulty"
  );
  if (cancelNewUserDifficultyBtn) {
    cancelNewUserDifficultyBtn.addEventListener("click", () => {
      closeNewUserDifficultyModal();
      showNewUserTimeModal();
    });
  }
  if (confirmNewUserDifficultyBtn) {
    confirmNewUserDifficultyBtn.addEventListener(
      "click",
      proceedToSubscription
    );
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

      // 기존 선택 모두 해제
      document.querySelectorAll(".language-card").forEach((otherCard) => {
        otherCard.classList.remove("selected");
      });

      // 현재 카드만 선택
      this.classList.add("selected");
      selectedLanguages = [language];

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
      const languageName = languageNames[selectedLanguages[0]];
      btn.innerHTML = `${languageName} 구독하기`;
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
    showResult("언어를 선택해주세요!", "error");
    return;
  }

  if (selectedLanguages.length > 1) {
    showResult("언어는 하나만 선택할 수 있습니다!", "error");
    return;
  }

  // 로그인 확인
  if (!currentUser) {
    // 로그인이 필요하다는 메시지만 표시하고 로그인 모달 열기
    showMessageModal("구독하려면 먼저 로그인해주세요.");
    setTimeout(() => {
      closeMessageModal();
      openLoginModal();
    }, 2000);
    return;
  }

  // 이미 구독된 사용자면 구독 업데이트
  if (currentUser.isSubscribed) {
    updateSubscription();
  } else {
    // 처음 구독하는 경우 언어 선택 결과 모달 표시
    showLanguageSelectedModal();
  }
}

async function createSubscription() {
  try {
    showProcessingModal("구독 처리 중...");

    // 선택된 시간대와 난이도 가져오기
    const timezoneSelect = document.getElementById("timezoneSelect");
    const selectedTime = timezoneSelect ? timezoneSelect.value : "09:00";
    selectedTimezone = selectedTime;

    const difficultySelect = document.getElementById("difficultySelect");
    const selectedDiff = difficultySelect ? difficultySelect.value : "basic";
    selectedDifficulty = selectedDiff;

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
        timezone: selectedTimezone,
        difficulty: selectedDifficulty,
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
      showResult(
        `🎉 ${data.nickname}님, 구독이 완료되었습니다!\n\n⚠️ 구독 후 2주 동안은 언어 변경이 불가능합니다.`,
        "success"
      );
    } else {
      showResult(
        getFriendlyErrorMessage(data.error) || "구독 처리에 실패했습니다.",
        "error"
      );
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

      // 구독된 사용자 UI로 다시 전환
      displaySubscribedUserUI();

      showResult("구독 정보가 업데이트되었습니다!", "success");
    } else {
      showResult(
        getFriendlyErrorMessage(data.error) || "구독 업데이트에 실패했습니다.",
        "error"
      );
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

  // 더 이상 자동으로 로그인이나 구독 처리하지 않음
  // 사용자가 직접 버튼을 눌러야 함
}

function proceedWithLogin() {
  // 카카오 로그인으로 이동 (언어 정보는 저장하지 않음)
  handleLoginClick();
}

function showMessageModal(message) {
  const modal = document.getElementById("messageModal");
  const messageText = document.getElementById("messageText");

  if (modal && messageText) {
    messageText.textContent = message;
    modal.classList.add("show");

    // 5초 후 자동으로 닫기
    setTimeout(() => {
      closeMessageModal();
    }, 5000);
  }
}

function closeMessageModal() {
  const modal = document.getElementById("messageModal");
  if (modal) {
    modal.classList.remove("show");
  }
}

function showErrorModal(message) {
  const modal = document.getElementById("errorModal");
  const errorText = document.getElementById("errorText");

  if (modal && errorText) {
    errorText.textContent = message;
    modal.classList.add("show");

    // 3초 후 자동으로 숨기기
    setTimeout(() => {
      modal.classList.remove("show");
    }, 3000);
  }
}

function showProcessingModal(message = "처리 중...") {
  const modal = document.getElementById("processingModal");
  const processingText = document.getElementById("processingText");

  if (modal && processingText) {
    processingText.textContent = message;
    modal.classList.add("show");
  }
}

function hideProcessingModal() {
  const modal = document.getElementById("processingModal");
  if (modal) {
    modal.classList.remove("show");
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

// 카카오 로그인 처리 (모달에서 사용)
function handleKakaoLogin() {
  // 디버깅 정보 출력
  console.log("=== 카카오 로그인 디버깅 정보 ===");
  console.log("현재 위치:", window.location.href);
  console.log("KAKAO_APP_KEY:", KAKAO_APP_KEY);
  console.log("REDIRECT_URI:", REDIRECT_URI);
  console.log("LOGIN_API_URL:", LOGIN_API_URL);
  console.log("환경 감지 - isLocalhost:", isLocalhost);
  console.log("환경 감지 - isFileProtocol:", isFileProtocol);

  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_APP_KEY}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code`;
  console.log("카카오 인증 URL:", kakaoAuthUrl);

  window.location.href = kakaoAuthUrl;
}

async function handleLoginCallback(authCode) {
  console.log("OAuth 콜백 처리 시작:", authCode);
  console.log("=== 로그인 콜백 디버깅 정보 ===");
  console.log("인증 코드:", authCode);
  console.log("LOGIN_API_URL:", LOGIN_API_URL);
  console.log("현재 origin:", window.location.origin);

  try {
    showProcessingModal("로그인 처리 중...");

    const requestBody = {
      action: "login",
      code: authCode,
    };

    console.log("Lambda로 전송할 요청:", requestBody);

    const response = await fetch(LOGIN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: window.location.origin,
      },
      body: JSON.stringify(requestBody),
    });

    console.log("Lambda 응답 상태:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.log("Lambda 에러 응답:", errorText);
      throw new Error(
        `HTTP ${response.status}: ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();
    console.log("로그인 응답:", data);
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
async function updateUIForLoggedInUser() {
  if (!currentUser) return;

  console.log("로그인된 사용자 UI 업데이트:", currentUser);

  // 네비게이션 업데이트 - 로그인 버튼 숨기고 드롭다운 표시
  if (loginBtn) {
    loginBtn.style.display = "none";
  }

  // 사용자 드롭다운 표시
  const userDropdown = document.getElementById("userDropdown");
  const userNickname = document.getElementById("userNickname");
  const userEmailSmall = document.getElementById("userEmailSmall");
  const userAvatar = document.getElementById("userAvatar");

  if (userDropdown) {
    userDropdown.style.display = "block";
  }

  if (userNickname) {
    userNickname.textContent = `${currentUser.nickname}님`;
  }

  // 이메일 정보 표시
  if (userEmailSmall && currentUser.email) {
    userEmailSmall.textContent = currentUser.email;
  }

  if (userAvatar) {
    userAvatar.src =
      currentUser.profileImage ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23667eea'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
  }

  // API에서 구독 정보 조회
  try {
    const subscriptionInfo = await getSubscriptionInfo(currentUser.id);

    if (subscriptionInfo && subscriptionInfo.subscription_status === "active") {
      // 구독 정보가 있으면 currentUser 업데이트
      currentUser.isSubscribed = true;
      currentUser.subscriptionStatus = subscriptionInfo.subscription_status;
      currentUser.languages = subscriptionInfo.languages || [];
      currentUser.timezone = subscriptionInfo.timezone || "09:00";
      currentUser.subscriptionDate = subscriptionInfo.subscription_date;

      // 세션 정보도 업데이트
      if (authSession) {
        authSession.userInfo = currentUser;
        authSession.saveToStorage();
      }

      // 구독된 사용자 UI 표시
      displaySubscribedUserUI();
    } else {
      // 구독 정보가 없으면 언어 선택 화면으로
      currentUser.isSubscribed = false;
      currentUser.subscriptionStatus = "inactive";

      // 언어 선택을 위한 화면 준비
      enableLanguageSelection();
    }
  } catch (error) {
    console.error("구독 정보 조회 오류:", error);
    // 오류 발생 시 언어 선택 화면으로
    enableLanguageSelection();
  }

  // Lucide 아이콘 재초기화
  if (typeof lucide !== "undefined") {
    setTimeout(() => {
      lucide.createIcons();
    }, 100);
  }
}

// 구독된 사용자 UI 표시 (별도 함수로 분리)
function displaySubscribedUserUI() {
  if (!currentUser || !currentUser.isSubscribed) return;

  // 기본 히어로 섹션 숨기기
  const heroSection = document.querySelector(".hero");
  if (heroSection) {
    heroSection.style.display = "none";
  }

  // 사용자 정보 섹션 표시
  if (userInfo) {
    userInfo.style.display = "block";
  }

  const userNameEl = document.getElementById("userName");
  const userEmailEl = document.getElementById("userEmail");
  const userProfileEl = document.getElementById("userProfile");
  const subscriptionStatusEl = document.getElementById("subscriptionStatus");
  const selectedLanguagesEl = document.getElementById("selectedLanguages");

  if (userNameEl) {
    userNameEl.textContent = `${currentUser.nickname}님, 안녕하세요!`;
  }

  if (userEmailEl) {
    userEmailEl.textContent = currentUser.email;
  }

  // 함께한지 N일째 표시
  const subscriptionDaysEl = document.getElementById("subscriptionDays");
  if (subscriptionDaysEl) {
    if (currentUser.subscriptionDate) {
      const subscriptionDate = new Date(currentUser.subscriptionDate);
      const today = new Date();
      const diffTime = Math.abs(today - subscriptionDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      subscriptionDaysEl.textContent = `${diffDays}일째`;
    } else {
      subscriptionDaysEl.textContent = "1일째";
    }
  }

  // 가입일 표시
  const subscriptionStartDateEl = document.getElementById(
    "subscriptionStartDate"
  );
  if (subscriptionStartDateEl && currentUser.subscriptionDate) {
    const date = new Date(currentUser.subscriptionDate);
    subscriptionStartDateEl.textContent = date.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  if (userProfileEl) {
    userProfileEl.src =
      currentUser.profileImage ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23667eea'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
  }

  if (subscriptionStatusEl) {
    subscriptionStatusEl.textContent = "활성";
    subscriptionStatusEl.style.color = "#34d399";
  }

  // 시간대 정보 업데이트
  if (currentUser.timezone) {
    selectedTimezone = currentUser.timezone;
    updateMessageTimeDisplay(currentUser.timezone);
  } else {
    // 기본값으로 설정
    currentUser.timezone = "09:00";
    selectedTimezone = "09:00";
    updateMessageTimeDisplay("09:00");
  }

  // 난이도 정보 업데이트
  if (currentUser.difficulty) {
    selectedDifficulty = currentUser.difficulty;
    updateDifficultyDisplay(currentUser.difficulty);
  } else {
    // 기본값으로 설정
    currentUser.difficulty = "basic";
    selectedDifficulty = "basic";
    updateDifficultyDisplay("basic");
  }

  if (
    currentUser.languages &&
    currentUser.languages.length > 0 &&
    selectedLanguagesEl
  ) {
    const languageNames = {
      english: "English",
      chinese: "中文",
      japanese: "日本語",
    };
    const names = currentUser.languages
      .map((lang) => languageNames[lang] || lang)
      .join(", ");
    selectedLanguagesEl.textContent = names;
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

  // 추가 데이터 정리 (이미 authSession.clear()에서 처리됨)
  // localStorage와 sessionStorage의 인증 관련 데이터는 authSession.clear()에서 정리됨

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

  // 기본 히어로 섹션 다시 보이기
  const heroSection = document.querySelector(".hero");
  if (heroSection) {
    heroSection.style.display = "block";
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
  // 기존 언어 선택 초기화
  selectedLanguages = [];

  // 모든 언어 카드의 선택 상태 해제
  document.querySelectorAll(".language-card").forEach((card) => {
    card.classList.remove("selected");
  });

  // 구독된 사용자의 언어 변경을 위한 UI 준비
  enableLanguageSelectionForExistingUser();

  // 언어 선택 섹션으로 스크롤
  const languagesSection = document.getElementById("languages");
  if (languagesSection) {
    languagesSection.scrollIntoView({ behavior: "smooth" });
  }

  // 1.5초 후에 메시지 표시 (스크롤 완료 후)
  setTimeout(() => {
    showMessageModal(
      "언어를 다시 선택하고 언어 설정 변경하기 버튼을 눌러주세요."
    );
  }, 1500);
}

// 기존 구독자의 언어 변경을 위한 UI 활성화 (사용자 정보 유지)
function enableLanguageSelectionForExistingUser() {
  // 사용자 정보 섹션은 유지하고 언어 카드만 활성화
  document.querySelectorAll(".language-card").forEach((card) => {
    card.classList.remove("disabled");
  });

  // 구독 버튼 텍스트 변경
  const subscribeBtn = document.querySelector(".subscribe-btn");
  if (subscribeBtn) {
    subscribeBtn.innerHTML = "언어 설정 변경하기";
    subscribeBtn.classList.remove("disabled");
    subscribeBtn.onclick = () => {
      if (selectedLanguages.length === 0) {
        showResult("언어를 선택해주세요.", "error");
        return;
      }

      if (selectedLanguages.length > 1) {
        showResult("언어는 하나만 선택할 수 있습니다.", "error");
        return;
      }

      // 기존 언어와 동일한지 확인
      const currentLanguages = currentUser.languages || [];
      const isSameSelection =
        currentLanguages.length === selectedLanguages.length &&
        currentLanguages.every((lang) => selectedLanguages.includes(lang));

      if (isSameSelection) {
        showResult("기존과 동일한 언어 선택입니다.", "error");
        return;
      }

      updateSubscription();
    };
  }
}

// 언어 선택 활성화
function enableLanguageSelection() {
  // 사용자 정보 섹션 숨기기
  if (userInfo) {
    userInfo.style.display = "none";
  }

  // 기본 히어로 섹션 다시 보이기
  const heroSection = document.querySelector(".hero");
  if (heroSection) {
    heroSection.style.display = "block";
  }

  document.querySelectorAll(".language-card").forEach((card) => {
    card.classList.remove("disabled");
  });

  // 구독 버튼 활성화 및 텍스트 변경
  const subscribeBtn = document.querySelector(".subscribe-btn");
  if (subscribeBtn) {
    if (currentUser && currentUser.isSubscribed) {
      // 기존 구독자인 경우 - 언어 변경
      subscribeBtn.innerHTML = "언어 설정 변경하기";
      subscribeBtn.classList.remove("disabled");
      subscribeBtn.onclick = () => {
        if (selectedLanguages.length === 0) {
          showResult("언어를 선택해주세요.", "error");
          return;
        }

        if (selectedLanguages.length > 1) {
          showResult("언어는 하나만 선택할 수 있습니다.", "error");
          return;
        }

        // 기존 언어와 동일한지 확인
        const currentLanguages = currentUser.languages || [];
        const isSameSelection =
          currentLanguages.length === selectedLanguages.length &&
          currentLanguages.every((lang) => selectedLanguages.includes(lang));

        if (isSameSelection) {
          showResult("기존과 동일한 언어 선택입니다.", "error");
          return;
        }

        updateSubscription();
      };
    } else {
      // 신규 구독자인 경우
      subscribeBtn.innerHTML = "언어 구독하기";
      subscribeBtn.classList.remove("disabled");
      subscribeBtn.onclick = subscribeService;
    }
  }
}

// 구독 취소 처리
async function handleUnsubscribe() {
  if (!currentUser) {
    showResult("로그인이 필요합니다.", "error");
    return;
  }

  showUnsubscribeModal();
}

function showUnsubscribeModal() {
  const unsubscribeModal = document.getElementById("unsubscribeModal");
  if (unsubscribeModal) {
    unsubscribeModal.style.display = "block";

    // Lucide 아이콘 재초기화
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  }
}

function closeUnsubscribeModal() {
  const unsubscribeModal = document.getElementById("unsubscribeModal");
  if (unsubscribeModal) {
    unsubscribeModal.style.display = "none";
  }
}

async function confirmUnsubscribe() {
  closeUnsubscribeModal();

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

      // UI 초기화 - 사용자 정보 섹션 숨기고 언어 선택으로 돌아가기
      if (userInfo) {
        userInfo.style.display = "none";
      }

      // 기본 히어로 섹션 다시 보이기
      const heroSection = document.querySelector(".hero");
      if (heroSection) {
        heroSection.style.display = "block";
      }

      // 로그인 상태는 유지하면서 구독 선택 화면으로 전환
      enableLanguageSelection();

      // 언어 선택 섹션으로 스크롤
      scrollToLanguages();

      showResult(
        "구독이 취소되었습니다. 언제든지 다시 구독하실 수 있습니다.",
        "success"
      );
    } else {
      showResult(
        getFriendlyErrorMessage(data.error) || "구독 취소에 실패했습니다.",
        "error"
      );
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

// 구독 확인 모달 관련
function showSubscriptionConfirmModal() {
  if (!subscriptionConfirmModal) return;

  // 선택한 언어 목록 표시
  const languageNames = {
    english: "영어",
    chinese: "중국어",
    japanese: "일본어",
  };

  const selectedLanguageNames = selectedLanguages
    .map((lang) => languageNames[lang])
    .join(", ");

  const confirmLanguagesList = document.getElementById("confirmLanguagesList");
  if (confirmLanguagesList) {
    confirmLanguagesList.textContent = selectedLanguageNames;
  }

  // 언어별 설명 업데이트
  updateSubscriptionDescription();

  subscriptionConfirmModal.style.display = "block";
}

// 언어별 설명 업데이트 함수
function updateSubscriptionDescription() {
  const infoBox = document.querySelector(".subscription-info .info-box");
  if (!infoBox) return;

  // 언어명 정의
  const languageNames = {
    english: "영어",
    chinese: "중국어",
    japanese: "일본어",
  };

  // 선택된 언어에 따른 예시 단어
  const languageExamples = {
    english: {
      word: "accomplish",
      pronunciation: "/əˈkʌmplɪʃ/",
      meaning: "성취하다, 완수하다",
      example: '"We accomplished our goal."',
    },
    chinese: {
      word: "成功",
      pronunciation: "chéng gōng",
      meaning: "성공하다",
      example: '"他很成功。" (그는 성공했다)',
    },
    japanese: {
      word: "勉強",
      pronunciation: "べんきょう",
      meaning: "공부, 학습",
      example: '"毎日勉強します。" (매일 공부합니다)',
    },
  };

  // 선택된 언어 (하나만 선택 가능)
  const selectedLanguage = selectedLanguages[0];
  const example = languageExamples[selectedLanguage];

  const description = `
    <p>• 매일 오전 9시 새로운 ${languageNames[selectedLanguage]} 단어를 받아보세요</p>
    <p>• <strong>${example.word}</strong> ${example.pronunciation} - ${example.meaning}</p>
    <p>• 예문: ${example.example}</p>
    <p>• 카카오톡으로 편리하게 수신하며 꾸준히 학습하세요</p>
  `;

  infoBox.innerHTML = description;
}

function closeSubscriptionConfirmModal() {
  if (subscriptionConfirmModal) {
    subscriptionConfirmModal.style.display = "none";
  }
}

function proceedWithSubscription() {
  closeSubscriptionConfirmModal();
  createSubscription();
}

// API 함수들
async function getSubscriptionInfo(userId) {
  try {
    const response = await fetch(SUBSCRIPTION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "get_subscription",
        user_id: userId,
      }),
    });

    const data = await response.json();

    if (data.success) {
      return data;
    } else {
      console.log("구독 정보 없음:", data.error);
      return null;
    }
  } catch (error) {
    console.error("구독 정보 조회 실패:", error);
    return null;
  }
}

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

// 디버깅용 함수 추가
async function debugLambdaEnvironment() {
  try {
    console.log("Lambda 환경변수 디버그 시작...");

    const response = await fetch(LOGIN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: window.location.origin,
      },
      body: JSON.stringify({
        action: "debug",
      }),
    });

    const data = await response.json();
    console.log("Lambda 환경변수 정보:", data);

    if (data.success) {
      alert(
        `Lambda 환경변수:\n${JSON.stringify(
          data.environment_variables,
          null,
          2
        )}`
      );
    } else {
      alert(`디버그 실패: ${data.error}`);
    }
  } catch (error) {
    console.error("디버그 에러:", error);
    alert(`디버그 에러: ${error.message}`);
  }
}

// 전역 함수로 노출 (콘솔에서 사용 가능)
window.debugLambdaEnvironment = debugLambdaEnvironment;

async function handleDeleteAccount() {
  // 드롭다운 닫기
  const userDropdown = document.getElementById("userDropdown");
  if (userDropdown) {
    userDropdown.classList.remove("active");
  }

  showDeleteAccountModal();
}

function showDeleteAccountModal() {
  const deleteAccountModal = document.getElementById("deleteAccountModal");
  if (deleteAccountModal) {
    deleteAccountModal.style.display = "block";

    // Lucide 아이콘 재초기화
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  }
}

function closeDeleteAccountModal() {
  const deleteAccountModal = document.getElementById("deleteAccountModal");
  if (deleteAccountModal) {
    deleteAccountModal.style.display = "none";
  }
}

async function confirmDeleteAccount() {
  closeDeleteAccountModal();

  try {
    showProcessingModal("회원탈퇴 처리 중...");

    const response = await fetch(SUBSCRIPTION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "delete_account",
        user_id: currentUser.id,
      }),
    });

    const data = await response.json();
    hideProcessingModal();

    if (data.statusCode === 200) {
      const responseBody = JSON.parse(data.body);
      showMessageModal(
        "회원탈퇴가 완료되었습니다. 그동안 이용해주셔서 감사합니다."
      );

      // 세션 정리 및 UI 업데이트
      setTimeout(() => {
        currentUser = null;
        authSession.clear();
        updateUIForLoggedOutUser();
        closeMessageModal();
      }, 2000);
    } else {
      const responseBody = JSON.parse(data.body);
      showErrorModal(responseBody.message || "회원탈퇴에 실패했습니다.");
    }
  } catch (error) {
    hideProcessingModal();
    console.error("회원탈퇴 중 오류 발생:", error);
    showErrorModal(
      "회원탈퇴 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
    );
  }
}

function updateUIForLoggedOutUser() {
  // 사용자 정보 숨기기
  const userInfo = document.getElementById("userInfo");
  const userInfoHero = document.getElementById("userInfoHero");
  const defaultHero = document.getElementById("defaultHero");

  if (userInfo) userInfo.style.display = "none";
  if (userInfoHero) userInfoHero.style.display = "none";
  if (defaultHero) defaultHero.style.display = "block";

  // 로그인/로그아웃 버튼 전환
  const loginBtn = document.getElementById("loginBtn");
  const userDropdown = document.getElementById("userDropdown");

  if (loginBtn) loginBtn.style.display = "block";
  if (userDropdown) userDropdown.style.display = "none";

  // 언어 카드 다시 활성화
  enableLanguageSelection();

  // 구독 버튼 재설정
  updateSubscribeButton();
}

// 시간대 관련 함수들
function showTimeChangeModal() {
  const timeChangeModal = document.getElementById("timeChangeModal");

  if (timeChangeModal) {
    // 현재 시간 표시 업데이트
    updateCurrentTimeDisplay();

    // 현재 선택된 시간 옵션 설정
    const currentTimezone = currentUser?.timezone || "09:00";
    setSelectedTimeOption(currentTimezone);

    // 시간 옵션 클릭 이벤트 설정
    setupTimeOptionEvents();

    timeChangeModal.style.display = "block";

    // Lucide 아이콘 재초기화
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  }
}

function updateCurrentTimeDisplay() {
  const currentTimeDisplay = document.getElementById("currentTimeDisplay");
  if (currentTimeDisplay && currentUser) {
    const timeMap = {
      "08:00": "오전 8시",
      "09:00": "오전 9시",
      "10:00": "오전 10시",
      "11:00": "오전 11시",
      "12:00": "오후 12시",
      "13:00": "오후 1시",
      "14:00": "오후 2시",
      "15:00": "오후 3시",
      "16:00": "오후 4시",
      "17:00": "오후 5시",
      "18:00": "오후 6시",
      "19:00": "오후 7시",
      "20:00": "오후 8시",
      "21:00": "오후 9시",
      "22:00": "오후 10시",
    };
    const currentTimezone = currentUser.timezone || "09:00";
    currentTimeDisplay.textContent = timeMap[currentTimezone] || "오전 9시";
  }
}

function setSelectedTimeOption(timezone) {
  // 모든 시간 옵션에서 selected 클래스 제거
  document.querySelectorAll(".time-option").forEach((option) => {
    option.classList.remove("selected");
  });

  // 현재 시간대에 해당하는 옵션에 selected 클래스 추가
  const selectedOption = document.querySelector(`[data-time="${timezone}"]`);
  if (selectedOption) {
    selectedOption.classList.add("selected");
  }
}

function setupTimeOptionEvents() {
  document.querySelectorAll(".time-option").forEach((option) => {
    option.addEventListener("click", function () {
      // 기존 선택 해제
      document.querySelectorAll(".time-option").forEach((opt) => {
        opt.classList.remove("selected");
      });

      // 새로운 선택
      this.classList.add("selected");
      selectedTimezone = this.dataset.time;
    });
  });
}

function closeTimeChangeModal() {
  const timeChangeModal = document.getElementById("timeChangeModal");
  if (timeChangeModal) {
    timeChangeModal.style.display = "none";
  }
}

async function handleTimeChange() {
  const selectedOption = document.querySelector(".time-option.selected");
  const newTimezone = selectedOption ? selectedOption.dataset.time : null;

  if (!currentUser || !newTimezone) {
    showErrorModal("시간을 선택해주세요.");
    return;
  }

  // 현재 시간과 동일한지 확인
  const currentTimezone = currentUser.timezone || "09:00";
  if (currentTimezone === newTimezone) {
    showErrorModal("현재와 동일한 시간입니다.");
    return;
  }

  try {
    showProcessingModal("시간 변경 중...");

    const response = await fetch(SUBSCRIPTION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "update_timezone",
        user_id: currentUser.id,
        timezone: newTimezone,
      }),
    });

    const data = await response.json();
    hideProcessingModal();

    if (data.statusCode === 200) {
      const responseBody = JSON.parse(data.body);

      // 사용자 정보 업데이트
      currentUser.timezone = newTimezone;
      selectedTimezone = newTimezone;

      // UI 업데이트
      updateMessageTimeDisplay(newTimezone);

      closeTimeChangeModal();
      showMessageModal("수신 시간이 변경되었습니다. 다음날부터 적용됩니다.");
    } else {
      const responseBody = JSON.parse(data.body);
      showErrorModal(responseBody.message || "시간 변경에 실패했습니다.");
    }
  } catch (error) {
    hideProcessingModal();
    console.error("시간 변경 중 오류 발생:", error);
    showErrorModal(
      "시간 변경 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
    );
  }
}

function updateMessageTimeDisplay(timezone) {
  const messageTimeElement = document.getElementById("messageTime");
  if (messageTimeElement) {
    const timeMap = {
      "08:00": "오전 8시",
      "09:00": "오전 9시",
      "10:00": "오전 10시",
      "11:00": "오전 11시",
      "12:00": "오후 12시",
      "13:00": "오후 1시",
      "14:00": "오후 2시",
      "15:00": "오후 3시",
      "16:00": "오후 4시",
      "17:00": "오후 5시",
      "18:00": "오후 6시",
      "19:00": "오후 7시",
      "20:00": "오후 8시",
      "21:00": "오후 9시",
      "22:00": "오후 10시",
    };
    messageTimeElement.textContent = timeMap[timezone] || "오전 9시";
  }
}

// 난이도 관련 함수들
function showDifficultyChangeModal() {
  const difficultyChangeModal = document.getElementById(
    "difficultyChangeModal"
  );

  if (difficultyChangeModal) {
    // 현재 난이도 표시 업데이트
    updateCurrentDifficultyDisplay();

    // 현재 선택된 난이도 옵션 설정
    const currentDifficulty = currentUser?.difficulty || "basic";
    setSelectedDifficultyOption(currentDifficulty);

    // 난이도 옵션 클릭 이벤트 설정
    setupDifficultyOptionEvents();

    difficultyChangeModal.style.display = "block";

    // Lucide 아이콘 재초기화
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  }
}

function updateCurrentDifficultyDisplay() {
  const currentDifficultyDisplay = document.getElementById(
    "currentDifficultyDisplay"
  );
  if (currentDifficultyDisplay && currentUser) {
    const difficultyMap = {
      basic: "BASIC",
      intermediate: "INTERMEDIATE",
      advanced: "ADVANCED",
    };
    const currentDifficulty = currentUser.difficulty || "basic";
    currentDifficultyDisplay.textContent =
      difficultyMap[currentDifficulty] || "BASIC";
  }
}

function setSelectedDifficultyOption(difficulty) {
  // 모든 난이도 옵션에서 selected 클래스 제거
  document.querySelectorAll(".difficulty-option").forEach((option) => {
    option.classList.remove("selected");
  });

  // 현재 난이도에 해당하는 옵션에 selected 클래스 추가
  const selectedOption = document.querySelector(
    `[data-difficulty="${difficulty}"]`
  );
  if (selectedOption) {
    selectedOption.classList.add("selected");
  }
}

function setupDifficultyOptionEvents() {
  document.querySelectorAll(".difficulty-option").forEach((option) => {
    option.addEventListener("click", function () {
      // 기존 선택 해제
      document.querySelectorAll(".difficulty-option").forEach((opt) => {
        opt.classList.remove("selected");
      });

      // 새로운 선택
      this.classList.add("selected");
      selectedDifficulty = this.dataset.difficulty;
    });
  });
}

function closeDifficultyChangeModal() {
  const difficultyChangeModal = document.getElementById(
    "difficultyChangeModal"
  );
  if (difficultyChangeModal) {
    difficultyChangeModal.style.display = "none";
  }
}

async function handleDifficultyChange() {
  const selectedOption = document.querySelector(".difficulty-option.selected");
  const newDifficulty = selectedOption
    ? selectedOption.dataset.difficulty
    : null;

  if (!currentUser || !newDifficulty) {
    showErrorModal("난이도를 선택해주세요.");
    return;
  }

  // 현재 난이도와 동일한지 확인
  const currentDifficulty = currentUser.difficulty || "basic";
  if (currentDifficulty === newDifficulty) {
    showErrorModal("현재와 동일한 난이도입니다.");
    return;
  }

  try {
    showProcessingModal("난이도 변경 중...");

    const response = await fetch(SUBSCRIPTION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "update_difficulty",
        user_id: currentUser.id,
        difficulty: newDifficulty,
      }),
    });

    const data = await response.json();
    hideProcessingModal();

    if (data.statusCode === 200) {
      const responseBody = JSON.parse(data.body);

      // 사용자 정보 업데이트
      currentUser.difficulty = newDifficulty;
      selectedDifficulty = newDifficulty;

      // UI 업데이트
      updateDifficultyDisplay(newDifficulty);

      closeDifficultyChangeModal();
      showMessageModal("학습 난이도가 변경되었습니다. 다음날부터 적용됩니다.");
    } else {
      const responseBody = JSON.parse(data.body);
      showErrorModal(
        getFriendlyErrorMessage(
          responseBody.message || "난이도 변경에 실패했습니다."
        )
      );
    }
  } catch (error) {
    hideProcessingModal();
    console.error("난이도 변경 중 오류 발생:", error);
    showErrorModal(
      "난이도 변경 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
    );
  }
}

function updateDifficultyDisplay(difficulty) {
  const difficultyElement = document.getElementById("difficultyLevel");
  if (difficultyElement) {
    const difficultyMap = {
      basic: "BASIC",
      intermediate: "INTERMEDIATE",
      advanced: "ADVANCED",
    };
    difficultyElement.textContent = difficultyMap[difficulty] || "BASIC";
  }
}

// 사용자 친화적인 에러 메시지 변환
function getFriendlyErrorMessage(serverError) {
  // 서버 에러 메시지를 사용자가 이해하기 쉬운 메시지로 변환
  const errorMappings = {
    // 일반적인 서버 에러들
    "Internal server error":
      "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
    "Service unavailable":
      "서비스를 일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해주세요.",
    "Request timeout":
      "요청 시간이 초과되었습니다. 네트워크 연결을 확인하고 다시 시도해주세요.",

    // 인증 관련 에러들
    Unauthorized: "로그인이 필요합니다. 다시 로그인해주세요.",
    "Access denied": "접근 권한이 없습니다.",
    "Token expired": "로그인 세션이 만료되었습니다. 다시 로그인해주세요.",
    "Invalid token": "인증 정보가 유효하지 않습니다. 다시 로그인해주세요.",

    // 구독 관련 에러들
    "User not found": "사용자 정보를 찾을 수 없습니다.",
    "Subscription not found": "구독 정보를 찾을 수 없습니다.",
    "Already subscribed": "이미 구독하신 언어입니다.",
    "Language change not allowed":
      "언어 변경이 제한된 기간입니다. 2주 후에 다시 시도해주세요.",

    // 데이터베이스 관련 에러들
    "Database connection failed":
      "일시적인 서버 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
    "Database timeout":
      "서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.",

    // API 관련 에러들
    "Invalid request":
      "잘못된 요청입니다. 페이지를 새로고침하고 다시 시도해주세요.",
    "Missing required parameters":
      "필수 정보가 누락되었습니다. 다시 시도해주세요.",
    "Rate limit exceeded":
      "너무 많은 요청을 보내셨습니다. 잠시 후 다시 시도해주세요.",

    // 네트워크 관련 에러들
    "Network error":
      "네트워크 연결에 문제가 있습니다. 인터넷 연결을 확인해주세요.",
    "Connection failed":
      "서버에 연결할 수 없습니다. 네트워크 연결을 확인해주세요.",
  };

  // 정확한 매칭 먼저 시도
  if (errorMappings[serverError]) {
    return errorMappings[serverError];
  }

  // 부분 매칭 시도
  for (const [key, value] of Object.entries(errorMappings)) {
    if (serverError.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }

  // HTTP 상태 코드 기반 처리
  if (serverError.includes("500")) {
    return "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
  }
  if (serverError.includes("404")) {
    return "요청하신 정보를 찾을 수 없습니다.";
  }
  if (serverError.includes("403")) {
    return "접근 권한이 없습니다.";
  }
  if (serverError.includes("401")) {
    return "로그인이 필요합니다. 다시 로그인해주세요.";
  }
  if (serverError.includes("400")) {
    return "잘못된 요청입니다. 페이지를 새로고침하고 다시 시도해주세요.";
  }

  // 기본 메시지
  return "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}

// 신규 가입자 언어 선택 결과 모달 관련 함수들
function showLanguageSelectedModal() {
  const languageSelectedModal = document.getElementById(
    "languageSelectedModal"
  );
  if (!languageSelectedModal) return;

  // 선택된 언어 정보 설정
  const selectedLanguage = selectedLanguages[0];
  const languageData = getLanguageData(selectedLanguage);

  // 언어별 배경 스타일 적용
  const languageCard = document.querySelector(".selected-language-card");
  if (languageCard) {
    // 기존 언어 클래스 제거
    languageCard.classList.remove("english", "chinese", "japanese");
    // 선택된 언어 클래스 추가
    languageCard.classList.add(selectedLanguage);
  }

  // 국기 이미지 설정
  const flagImg = document.getElementById("selectedLanguageFlag");
  if (flagImg) {
    flagImg.src = languageData.flag;
    flagImg.alt = `${languageData.name} 국기`;
  }

  // 언어 이름과 설명 설정
  const languageName = document.getElementById("selectedLanguageName");
  if (languageName) {
    languageName.textContent = languageData.name;
  }

  const languageDesc = document.getElementById("selectedLanguageDesc");
  if (languageDesc) {
    languageDesc.textContent = languageData.desc;
  }

  // 샘플 단어 설정
  const languageSample = document.getElementById("selectedLanguageSample");
  if (languageSample) {
    languageSample.innerHTML = `
      <div class="sample-word">${languageData.sample.word}</div>
      <div class="sample-pronunciation">${languageData.sample.pronunciation}</div>
      <div class="sample-meaning">${languageData.sample.meaning}</div>
      <div class="sample-example">${languageData.sample.example}</div>
    `;
  }

  languageSelectedModal.style.display = "block";

  // Lucide 아이콘 재초기화
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
}

function getLanguageData(language) {
  const languageMap = {
    english: {
      name: "English",
      desc: "영어 단어 학습",
      flag: "assets/us.png",
      sample: {
        word: "accomplish",
        pronunciation: "/əˈkʌmplɪʃ/",
        meaning: "성취하다, 완수하다",
        example: '"We accomplished our goal." (우리는 목표를 달성했다)',
      },
    },
    chinese: {
      name: "中文",
      desc: "중국어 단어 학습",
      flag: "assets/china.png",
      sample: {
        word: "成功",
        pronunciation: "chéng gōng",
        meaning: "성공하다",
        example: '"他很成功。" (그는 성공했다)',
      },
    },
    japanese: {
      name: "日本語",
      desc: "일본어 단어 학습",
      flag: "assets/japan.png",
      sample: {
        word: "勉強",
        pronunciation: "べんきょう",
        meaning: "공부, 학습",
        example: '"毎日勉強します。" (매일 공부합니다)',
      },
    },
  };

  return languageMap[language] || languageMap.english;
}

function closeLanguageSelectedModal() {
  const languageSelectedModal = document.getElementById(
    "languageSelectedModal"
  );
  if (languageSelectedModal) {
    languageSelectedModal.style.display = "none";
  }
}

function backToLanguageSelection() {
  closeLanguageSelectedModal();
  // 언어 선택 해제
  selectedLanguages = [];

  // 모든 언어 카드에서 selected 클래스 제거
  document.querySelectorAll(".language-card").forEach((card) => {
    card.classList.remove("selected");
  });

  // 구독 버튼 업데이트
  updateSubscribeButton();
}

function proceedToTimeSelection() {
  closeLanguageSelectedModal();
  showNewUserTimeModal();
}

function showNewUserTimeModal() {
  const newUserTimeModal = document.getElementById("newUserTimeModal");
  if (newUserTimeModal) {
    newUserTimeModal.style.display = "block";

    // 시간 선택 이벤트 설정
    setupNewUserTimeOptionEvents();

    // Lucide 아이콘 재초기화
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  }
}

function setupNewUserTimeOptionEvents() {
  const timeOptions = document.querySelectorAll(
    "#newUserTimeModal .time-option"
  );
  const currentTimeDisplay = document.getElementById("newUserCurrentTime");

  timeOptions.forEach((option) => {
    option.addEventListener("click", () => {
      // 기존 선택 해제
      timeOptions.forEach((opt) => opt.classList.remove("selected"));
      // 새로운 선택 적용
      option.classList.add("selected");

      // 현재 시간 표시 업데이트
      const timeValue = option.querySelector(".time-value").textContent;
      if (currentTimeDisplay) {
        currentTimeDisplay.textContent = timeValue;
      }

      // 선택된 시간대 저장
      selectedTimezone = option.dataset.time;
    });
  });
}

function closeNewUserTimeModal() {
  const newUserTimeModal = document.getElementById("newUserTimeModal");
  if (newUserTimeModal) {
    newUserTimeModal.style.display = "none";
  }
}

function proceedToNewUserDifficulty() {
  closeNewUserTimeModal();
  showNewUserDifficultyModal();
}

function showNewUserDifficultyModal() {
  const newUserDifficultyModal = document.getElementById(
    "newUserDifficultyModal"
  );
  if (newUserDifficultyModal) {
    newUserDifficultyModal.style.display = "block";

    // 난이도 선택 이벤트 설정
    setupNewUserDifficultyOptionEvents();

    // Lucide 아이콘 재초기화
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  }
}

function setupNewUserDifficultyOptionEvents() {
  const difficultyOptions = document.querySelectorAll(
    "#newUserDifficultyModal .difficulty-option"
  );
  const currentDifficultyDisplay = document.getElementById(
    "newUserCurrentDifficulty"
  );

  difficultyOptions.forEach((option) => {
    option.addEventListener("click", () => {
      // 기존 선택 해제
      difficultyOptions.forEach((opt) => opt.classList.remove("selected"));
      // 새로운 선택 적용
      option.classList.add("selected");

      // 현재 난이도 표시 업데이트
      const difficultyValue =
        option.querySelector(".difficulty-value").textContent;
      if (currentDifficultyDisplay) {
        currentDifficultyDisplay.textContent = difficultyValue;
      }

      // 선택된 난이도 저장
      selectedDifficulty = option.dataset.difficulty;
    });
  });
}

function closeNewUserDifficultyModal() {
  const newUserDifficultyModal = document.getElementById(
    "newUserDifficultyModal"
  );
  if (newUserDifficultyModal) {
    newUserDifficultyModal.style.display = "none";
  }
}

function proceedToSubscription() {
  closeNewUserDifficultyModal();
  updateSubscriptionConfirmModal();
  showSubscriptionConfirmModal();
}

function updateSubscriptionConfirmModal() {
  // 선택한 시간대 표시
  const confirmTimeDisplay = document.getElementById("confirmTimeDisplay");
  if (confirmTimeDisplay) {
    const timeText = formatTimeDisplay(selectedTimezone);
    confirmTimeDisplay.textContent = timeText;
  }

  // 선택한 난이도 표시
  const confirmDifficultyDisplay = document.getElementById(
    "confirmDifficultyDisplay"
  );
  if (confirmDifficultyDisplay) {
    const difficultyText = formatDifficultyDisplay(selectedDifficulty);
    confirmDifficultyDisplay.textContent = difficultyText;
  }

  // 동적 안내문구 업데이트
  updateDynamicMessages();
}

function updateDynamicMessages() {
  // 초록색 박스를 제거했으므로 이 함수는 더 이상 필요하지 않음
  // 필요시 나중에 다른 동적 메시지 업데이트에 사용 가능
}

function formatTimeDisplay(timezone) {
  const timeMap = {
    "08:00": "오전 8시",
    "09:00": "오전 9시",
    "10:00": "오전 10시",
    "11:00": "오전 11시",
    "12:00": "오후 12시",
    "13:00": "오후 1시",
    "14:00": "오후 2시",
    "15:00": "오후 3시",
    "16:00": "오후 4시",
    "17:00": "오후 5시",
    "18:00": "오후 6시",
    "19:00": "오후 7시",
    "20:00": "오후 8시",
    "21:00": "오후 9시",
    "22:00": "오후 10시",
  };
  return timeMap[timezone] || "오전 9시";
}

function formatDifficultyDisplay(difficulty) {
  const difficultyMap = {
    basic: "BASIC",
    intermediate: "INTERMEDIATE",
    advanced: "ADVANCED",
  };
  return difficultyMap[difficulty] || "BASIC";
}
