import { describe, it, expect } from "vite-plus/test";
import { auth } from "./auth";

describe("deviceAuthorization plugin integration", () => {
  it("requests device code successfully without callback URL", async () => {
    const req = new Request("http://localhost:4321/api/auth/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "uooc-test-plugin",
        scope: "read write",
      }),
    });

    const res = await auth.handler(req);
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
      expires_in: number;
      interval: number;
    };

    expect(data.device_code).toBeDefined();
    expect(typeof data.device_code).toBe("string");
    expect(data.user_code).toBeDefined();
    expect(typeof data.user_code).toBe("string");
    expect(data.verification_uri).toContain("/device");
    expect(data.verification_uri_complete).toContain(`/device?user_code=${data.user_code}`);
    expect(data.expires_in).toBeGreaterThan(0);
    expect(data.interval).toBeGreaterThan(0);
  });

  it("handles authorization pending polling before user approval", async () => {
    // 1. Request a code
    const codeReq = new Request("http://localhost:4321/api/auth/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "uooc-test-plugin",
      }),
    });
    const codeRes = await auth.handler(codeReq);
    expect(codeRes.status).toBe(200);
    const { device_code } = (await codeRes.json()) as { device_code: string };

    // 2. Poll token immediately - status should be authorization_pending
    const tokenReq = new Request("http://localhost:4321/api/auth/device/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code,
        client_id: "uooc-test-plugin",
      }),
    });

    const tokenRes = await auth.handler(tokenReq);
    expect(tokenRes.status).toBe(400);
    const tokenData = (await tokenRes.json()) as { error: string };
    expect(tokenData.error).toBe("authorization_pending");
  });

  it("returns 400 when verifying an invalid user code", async () => {
    const req = new Request("http://localhost:4321/api/auth/device?user_code=NON_EXISTENT_CODE", {
      method: "GET",
    });

    const res = await auth.handler(req);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("invalid_request");
  });

  it("completes full device authorization flow: code -> verify -> approve -> token -> authenticated session", async () => {
    // 1. Create a logged-in user session
    const anonRes = await auth.api.signInAnonymous();
    expect(anonRes.user).toBeDefined();
    expect(anonRes.token).toBeDefined();

    const authHeaders = {
      Authorization: `Bearer ${anonRes.token}`,
      "Content-Type": "application/json",
    };

    // 2. Client requests device code without callback URL
    const codeReq = new Request("http://localhost:4321/api/auth/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "uooc-browser-extension",
        scope: "read write",
      }),
    });
    const codeRes = await auth.handler(codeReq);
    expect(codeRes.status).toBe(200);
    const { device_code, user_code } = (await codeRes.json()) as {
      device_code: string;
      user_code: string;
    };

    // 3. User opens /device page with user_code while logged in (claims and verifies the code)
    const verifyReq = new Request(
      `http://localhost:4321/api/auth/device?user_code=${encodeURIComponent(user_code)}`,
      {
        method: "GET",
        headers: authHeaders,
      },
    );
    const verifyRes = await auth.handler(verifyReq);
    expect(verifyRes.status).toBe(200);
    const verifyData = (await verifyRes.json()) as { client_id: string; status: string };
    expect(verifyData.client_id).toBe("uooc-browser-extension");
    expect(verifyData.status).toBe("pending");

    // 4. User approves the device authorization
    const approveReq = new Request("http://localhost:4321/api/auth/device/approve", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ userCode: user_code }),
    });
    const approveRes = await auth.handler(approveReq);
    expect(approveRes.status).toBe(200);
    const approveData = (await approveRes.json()) as { success: boolean };
    expect(approveData.success).toBe(true);

    // 5. Client polls and obtains access token
    const tokenReq = new Request("http://localhost:4321/api/auth/device/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code,
        client_id: "uooc-browser-extension",
      }),
    });
    const tokenRes = await auth.handler(tokenReq);
    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(tokenData.access_token).toBeDefined();
    expect(tokenData.token_type).toBe("Bearer");

    // 6. Verify that the issued access_token resolves to the authenticated user
    const sessionReq = new Request("http://localhost:4321/api/auth/get-session", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });
    const sessionRes = await auth.handler(sessionReq);
    expect(sessionRes.status).toBe(200);
    const sessionData = (await sessionRes.json()) as { user: { id: string } };
    expect(sessionData.user.id).toBe(anonRes.user.id);
  });
});
