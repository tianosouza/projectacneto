import { PrismaClient } from "@prisma/client";
import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
}

async function main() {
  const email = (process.env.ADMIN_EMAIL || "admin@acnetotransportes.com").trim().toLowerCase();
  const fullName = (process.env.ADMIN_NAME || "Administrador").trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
  }

  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          "admin.demo@acneto.com",
          "operator.demo@acneto.com",
          "driver.demo@acneto.com",
        ],
      },
    },
  });

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { fullName, passwordHash },
    create: { email, fullName, passwordHash },
  });

  await prisma.profile.upsert({
    where: { userId: user.id },
    update: { fullName, role: "admin", approved: true },
    create: { userId: user.id, fullName, role: "admin", approved: true },
  });

  console.log(`Administrador disponível para acesso: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());