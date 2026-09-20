import { UserRole } from "../entities/User";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: UserRole;
        emailVerified: boolean;
        proVerified: boolean;
      };
      /** Output of the validate() middleware. */
      valid: {
        params: any;
        query: any;
        body: any;
      };
    }
  }
}

export {};
