import { http } from '../http';

const API_BASE = 'https://api.line.me';

export interface LineProfile {
  displayName: string;
  pictureUrl?: string;
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
      throw new Error(`LINE API ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res;
  }

  async reply(replyToken: string, messages: unknown[]): Promise<void> {
    await this.request('POST', '/v2/bot/message/reply', { replyToken, messages });
  }

  async getGroupMemberProfile(groupId: string, userId: string): Promise<LineProfile> {
    const path = `/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`;
    return (await this.request('GET', path)).json<LineProfile>();
  }

  async getGroupName(groupId: string): Promise<string> {
    const path = `/v2/bot/group/${encodeURIComponent(groupId)}/summary`;
    return (await (await this.request('GET', path)).json<{ groupName: string }>()).groupName;
  }
}
