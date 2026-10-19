import { http } from '../http';

const API_BASE = 'https://api.line.me';

export interface LineProfile {
  displayName: string;
  pictureUrl?: string;
}

export class LineApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class LineClient {
  constructor(private readonly accessToken: string) {}

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const res = await http.fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new LineApiError(`LINE API ${method} ${path} failed: ${res.status} ${await res.text()}`, res.status);
    }
    return res;
  }

  async reply(replyToken: string, messages: unknown[]): Promise<void> {
    await this.request('POST', '/v2/bot/message/reply', { replyToken, messages });
  }

  /** Push message; counts against the official account's monthly quota. */
  async push(to: string, messages: unknown[]): Promise<void> {
    await this.request('POST', '/v2/bot/message/push', { to, messages });
  }

  /** Monthly push allowance (`null` = unlimited plan) and this month's usage. */
  async getPushQuota(): Promise<{ quota: number | null; used: number }> {
    const [quota, consumption] = await Promise.all([
      this.request('GET', '/v2/bot/message/quota').then((r) => r.json<{ type: string; value?: number }>()),
      this.request('GET', '/v2/bot/message/quota/consumption').then((r) => r.json<{ totalUsage: number }>()),
    ]);
    return { quota: quota.type === 'limited' ? (quota.value ?? null) : null, used: consumption.totalUsage };
  }

  async getGroupMemberProfile(groupId: string, userId: string): Promise<LineProfile> {
    const path = `/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`;
    return (await this.request('GET', path)).json<LineProfile>();
  }

  /** Whether the user is currently in the group (LINE answers 404 when not). */
  async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    try {
      await this.getGroupMemberProfile(groupId, userId);
      return true;
    } catch (err) {
      if (err instanceof LineApiError && err.status === 404) return false;
      throw err;
    }
  }

  async getGroupName(groupId: string): Promise<string> {
    const path = `/v2/bot/group/${encodeURIComponent(groupId)}/summary`;
    return (await (await this.request('GET', path)).json<{ groupName: string }>()).groupName;
  }
}
