import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { AuthProvider } from "../auth/AuthContext";
import { I18nProvider, LanguageToggle, loadHindi, t, useI18n } from "./i18n";
import { json, mockFetch } from "../test/http";
import { Keyed } from "../components/Keyed";

function Form() {
  useI18n();
  const [text, setText] = useState("");
  return (
    <div>
      <p>{t("Log in")}</p>
      <input aria-label="draft" value={text} onChange={(e) => setText(e.target.value)} />
      <LanguageToggle />
    </div>
  );
}

describe("language switch (fe-logic HIGH 6)", () => {
  it("re-renders in Hindi without remounting, so typed input survives", async () => {
    await loadHindi();
    mockFetch((url) => (url === "/api/auth/refresh" ? json(401, {}) : undefined));
    render(
      <AuthProvider>
        <I18nProvider>
          <Form />
        </I18nProvider>
      </AuthProvider>
    );
    await userEvent.type(screen.getByLabelText("draft"), "half-typed job");
    await userEvent.click(screen.getByRole("button", { name: /हिन्दी/ }));
    expect(await screen.findByText("लॉग इन")).toBeInTheDocument();
    expect(screen.getByLabelText("draft")).toHaveValue("half-typed job");
  });
});

describe("job pages are keyed by id (fe-logic HIGH 5)", () => {
  it("navigating job to job starts from a clean state", async () => {
    function Job() {
      const { id } = useParams();
      const [seen] = useState(id); // state captured on mount
      const nav = useNavigate();
      useEffect(() => undefined, []);
      return (
        <div>
          <p>mounted for {seen}</p>
          <button onClick={() => nav("/jobs/b")}>next</button>
        </div>
      );
    }
    render(
      <MemoryRouter initialEntries={["/jobs/a"]}>
        <Routes>
          <Route path="/jobs/:id" element={<Keyed param="id"><Job /></Keyed>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("mounted for a")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByText("mounted for b")).toBeInTheDocument();
  });
});
