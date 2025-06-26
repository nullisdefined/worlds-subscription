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
  console.log("Production Environment");
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

function subscribeService() {
  if (selectedLanguages.length === 0) {
    showResult("언어를 최소 1개 이상 선택해주세요!", "error");
    return;
  }

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
    showResult(`로그인 실패: ${errorDescription || error}`, "error");
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
    showResult("보안 검증 실패. 다시 시도해주세요.", "error");
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
  showResult("구독 처리 중...", "info");

  const requestBody = {
    action: "subscribe",
    code: authCode,
    languages: selectedLanguages,
  };

  console.log("Sending subscription request:", requestBody);

  fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(requestBody),
  })
    .then((response) => {
      console.log("Response status:", response.status);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
        showResult("구독 실패: " + (data.error || "알 수 없는 오류"), "error");
      }
    })
    .catch((error) => {
      console.error("Subscription error:", error);

      // 로딩 해제
      hideLoading();

      showResult("오류 발생: " + error.message, "error");

      // URL 정리
      window.history.replaceState({}, document.title, window.location.pathname);
    });
}

// 카카오 로그인 (구독이 아닌 단순 로그인)
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
    loginBtn.onclick = () => {
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

  // 언어 카드 선택 상태 업데이트
  if (currentUser.languages) {
    currentUser.languages.forEach((lang) => {
      const card = document.querySelector(`[data-language="${lang}"]`);
      if (card) {
        card.classList.add("selected");
      }
    });
    updateSubscribeButton();
  }
}

// 구독 관리
function showSubscriptionManagement() {
  const options = [
    "• 언어 선택 변경",
    "• 구독 일시정지",
    "• 구독 완전 해지",
    "• 알림 시간 설정",
  ];

  if (
    confirm(
      `구독 관리 옵션:\n\n${options.join(
        "\n"
      )}\n\n변경사항이 있으시면 확인을 눌러주세요.`
    )
  ) {
    showResult(
      "구독 설정을 변경하시려면 언어를 다시 선택하고 구독하기를 눌러주세요.",
      "info"
    );
    const languagesSection = document.getElementById("languages");
    if (languagesSection) {
      languagesSection.scrollIntoView({ behavior: "smooth" });
    }
  }
}

// 로그아웃
function handleLogout() {
  if (confirm("로그아웃하시겠습니까?")) {
    localStorage.removeItem("currentUser");
    currentUser = null;

    // UI 초기화
    if (loginBtn) {
      loginBtn.textContent = "로그인";
      loginBtn.classList.remove("btn-primary");
      loginBtn.classList.add("btn-outline");
      loginBtn.onclick = openLoginModal;
    }
    if (userInfo) {
      userInfo.style.display = "none";
    }

    // 언어 카드 선택 초기화
    document.querySelectorAll(".language-card").forEach((card) => {
      card.classList.remove("selected");
    });
    document
      .querySelector('[data-language="english"]')
      ?.classList.add("selected");
    selectedLanguages = ["english"];

    // 구독 버튼 복원
    updateSubscribeButton();

    showResult("로그아웃되었습니다.", "info");
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

// 결과 메시지 표시
function showResult(message, type) {
  const result = document.getElementById("result");
  if (result) {
    result.textContent = message;
    result.className = type;
    result.style.display = "block";

    // 자동 숨김 (에러가 아닌 경우)
    if (type !== "error") {
      setTimeout(() => {
        result.style.display = "none";
      }, 5000);
    }

    // 메시지 위치로 스크롤
    result.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// 로딩 표시
function showLoading() {
  const result = document.getElementById("result");
  if (result) {
    result.innerHTML = '<div class="loading"></div>처리 중...';
    result.className = "info loading";
    result.style.display = "block";
  }
}

// 로딩 숨김
function hideLoading() {
  const result = document.getElementById("result");
  if (result && result.classList.contains("loading")) {
    result.style.display = "none";
    result.classList.remove("loading");
  }
}
