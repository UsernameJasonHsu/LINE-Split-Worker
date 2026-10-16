export interface Env {
  DB: D1Database;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_LOGIN_CHANNEL_ID: string;
  LIFF_ID: string;
  /** Comma-separated LINE user ids allowed to review feedback. */
  ADMIN_LINE_USER_IDS: string;
  /** "on" to push new feedback to admins (uses the monthly push quota). */
  FEEDBACK_PUSH: string;
}

export interface AuthUser {
  lineUserId: string;
  displayName: string;
  pictureUrl: string | null;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { user: AuthUser };
}
