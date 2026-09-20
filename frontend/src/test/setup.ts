import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { setAccessToken } from "../api/client";

afterEach(() => {
  cleanup();
  setAccessToken(null);
  localStorage.clear();
});
