import "reflect-metadata";
import "dotenv/config";
import express from "express";
import cors from "cors";
import { AppDataSource } from "./data-source";
import { uploadsDir } from "./middleware/upload";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import jobRoutes from "./routes/jobs";
import bidRoutes from "./routes/bids";
import disputeRoutes from "./routes/disputes";
import profileRoutes from "./routes/profile";
import reviewRoutes from "./routes/reviews";
import messageRoutes from "./routes/messages";
import notificationRoutes from "./routes/notifications";
import favoriteRoutes from "./routes/favorites";
import { cacheReady, initCache } from "./utils/cache";

const app = express();
const port = parseInt(process.env.PORT || "3001", 10);

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "fixlocal-backend",
    redis: cacheReady() ? "connected" : "unavailable",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/bids", bidRoutes);
app.use("/api/disputes", disputeRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/favorites", favoriteRoutes);

async function ensureNotificationEnum() {
  // TypeORM synchronize often cannot ADD VALUE to existing Postgres enums
  const values = ["pro_available", "match"];
  for (const v of values) {
    try {
      await AppDataSource.query(
        `ALTER TYPE notifications_type_enum ADD VALUE IF NOT EXISTS '${v}'`
      );
    } catch (e: any) {
      // Older PG without IF NOT EXISTS — ignore duplicate / missing type
      const msg = String(e?.message || e);
      if (!/already exists|does not exist/i.test(msg)) {
        console.warn("enum ensure:", msg);
      }
    }
  }
}

async function start() {
  try {
    await AppDataSource.initialize();
    console.log("Database connected");
    await ensureNotificationEnum();
    await initCache();

    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  } catch (err) {
    console.error("Failed to start:", err);
    process.exit(1);
  }
}

start();
