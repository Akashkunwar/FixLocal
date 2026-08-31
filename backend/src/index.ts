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

async function start() {
  try {
    await AppDataSource.initialize();
    console.log("Database connected");
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
