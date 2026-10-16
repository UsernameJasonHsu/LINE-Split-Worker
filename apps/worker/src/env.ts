export interface Env {
  DB: D1Database;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_LOGIN_CHANNEL_ID: string;
  LIFF_ID: string;
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
