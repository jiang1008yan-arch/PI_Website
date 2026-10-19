// Seeds the LOCAL development D1 (wrangler --local) with one test account per
// role and a sample product, so every flow can be clicked through locally.
// Never run against the remote database.
//
//   npm run db:migrate:local
//   node scripts/seed-local-dev.mjs
//
// Test accounts (local only): admin_dev, sales_dev, service_dev, commerce_dev,
// all with the password below.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";

const PASSWORD = "LocalDev@2026";
const USERS = [
  ["usr_dev_admin", "admin_dev", "Dev Admin (Presales)", "ADMIN"],
  ["usr_dev_sales", "sales_dev", "Dev Sales", "SALES"],
  ["usr_dev_service", "service_dev", "Dev After-Sales", "SERVICE"],
  ["usr_dev_commerce", "commerce_dev", "Dev Commerce", "COMMERCE"]
];

const hash = bcrypt.hashSync(PASSWORD, 10);
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const sql = [
  ...USERS.map(
    ([id, username, name, role]) =>
      `INSERT OR REPLACE INTO users (id, username, passwordHash, displayName, role) VALUES (${q(id)}, ${q(username)}, ${q(hash)}, ${q(name)}, ${q(role)});`
  ),
  "INSERT OR IGNORE INTO senderProfile (id, corp, address, fromName, phone, email) VALUES (1, '', '', '', '', '');",
  "INSERT OR IGNORE INTO categories (id, code, nameEn, nameZh) VALUES ('cat_dev', 'DEV', 'Chargers', '充电桩');",
  "INSERT OR IGNORE INTO products (id, code, nameEn, nameZh, categoryId, status) VALUES ('prd_dev_ac7', 'AC7', 'AC Charger 7kW', '交流充电桩 7kW', 'cat_dev', 'ACTIVE');",
  "INSERT OR IGNORE INTO products (id, code, nameEn, nameZh, categoryId, status) VALUES ('prd_dev_dc60', 'DC60', 'DC Charger 60kW', '直流充电桩 60kW', 'cat_dev', 'ACTIVE');"
].join("\n");

const dir = mkdtempSync(join(tmpdir(), "pi-seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, sql);
execFileSync("npx", ["wrangler", "d1", "execute", "sales-portal-db", "--local", `--file=${file}`], { stdio: "inherit", shell: true });
console.log(`Seeded ${USERS.length} local test accounts.`);
