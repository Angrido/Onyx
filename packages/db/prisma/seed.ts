import { connectDatabase } from "../src/client";
import { seedDatabase } from "../src/seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const prisma = await connectDatabase({ url });
try {
  const report = await seedDatabase(prisma);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await prisma.$disconnect();
}
