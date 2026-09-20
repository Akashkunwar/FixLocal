import { z } from "zod";

// A short denylist of the most common passwords that meet the length rule.
const COMMON = new Set(
  [
    "password1", "password12", "password123", "password1234", "password12345", "password123!",
    "passw0rd123", "1234567890", "12345678910", "123456789012", "0123456789", "1111111111",
    "0000000000", "qwertyuiop", "qwerty1234", "qwerty12345", "qwerty123456", "1q2w3e4r5t",
    "1qaz2wsx3edc", "asdfghjkl1", "iloveyou12", "iloveyou123", "sunshine12", "princess12",
    "football12", "baseball12", "welcome123", "welcome1234", "letmein123", "monkey1234",
    "dragon1234", "master1234", "admin12345", "administrator", "changeme123", "trustno1234",
    "abc1234567", "abcdef1234", "abcd123456", "fixlocal123", "india12345", "bangalore1",
    "bengaluru1", "qwertyuiop1", "zxcvbnm123", "superman12", "batman1234", "starwars12",
  ].map((p) => p.toLowerCase())
);

export const newPassword = z
  .string({ message: "Password is required" })
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters")
  .refine((p) => !COMMON.has(p.toLowerCase()), "This password is too common; choose another");

/** Login accepts whatever was set before the policy existed. */
export const existingPassword = z.string({ message: "Password is required" }).min(1, "Password is required").max(256);
