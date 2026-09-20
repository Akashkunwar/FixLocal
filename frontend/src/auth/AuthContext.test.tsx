import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";
import { hasAccessToken } from "../api/client";
import { json, mockFetch } from "../test/http";

const user = { id: "u1", email: "c@x.test", role: "HOMEOWNER", emailVerified: true };
const templates = { invite: [{ id: "i1", label: "Hi", body: "Please bid" }], counter: [], homeownerCounter: [], intro: [], namedJob: [] };

function Probe() {
  const { user, loading, logout, updateProfile } = useAuth();
  if (loading) return <p>loading</p>;
  if (!user) return <p>signed out</p>;
  return (
    <div>
      <p>signed in as {user.email}</p>
      <p>invite templates: {user.inviteTemplates?.map((t) => t.body).join(",")}</p>
      <button onClick={() => void updateProfile({ inviteTemplates: [{ id: "i2", label: "New", body: "Fresh" }] })}>save</button>
      <button onClick={() => void logout()}>log out</button>
    </div>
  );
}

describe("AuthProvider", () => {
  it("restores the session from the refresh cookie and loads templates from the account", async () => {
    mockFetch((url) => {
      if (url === "/api/auth/refresh") return json(200, { token: "t", expiresIn: 900, user });
      if (url === "/api/auth/me/templates") return json(200, { templates });
      return undefined;
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText("signed in as c@x.test")).toBeInTheDocument();
    expect(screen.getByText("invite templates: Please bid")).toBeInTheDocument();
  });

  it("stays signed out when there is no refresh cookie", async () => {
    mockFetch((url) => (url === "/api/auth/refresh" ? json(401, {}) : undefined));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });

  it("saves templates with PUT per kind", async () => {
    const { calls } = mockFetch((url, init) => {
      if (url === "/api/auth/refresh") return json(200, { token: "t", expiresIn: 900, user });
      if (url === "/api/auth/me/templates") return json(200, { templates });
      if (url === "/api/auth/me/templates/invite" && init.method === "PUT") {
        return json(200, { kind: "invite", items: JSON.parse(String(init.body)).items });
      }
      return undefined;
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "save" }));
    expect(await screen.findByText("invite templates: Fresh")).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/auth/me" && c.init.method === "PATCH")).toBe(false);
  });

  it("logging out ends the server session and clears this browser's drafts", async () => {
    localStorage.setItem("fixlocal_job_draft_v3", "{\"title\":\"private\"}");
    const { calls } = mockFetch((url) => {
      if (url === "/api/auth/refresh") return json(200, { token: "t", expiresIn: 900, user });
      if (url === "/api/auth/me/templates") return json(200, { templates });
      if (url === "/api/auth/logout") return json(200, { ok: true });
      return undefined;
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "log out" }));
    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/auth/logout")).toBe(true);
    expect(localStorage.getItem("fixlocal_job_draft_v3")).toBeNull();
    await waitFor(() => expect(hasAccessToken()).toBe(false));
  });
});
