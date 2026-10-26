// يحمّل متغيرات البيئة المحلية (.env.local) للاختبارات التكاملية.
// لا يتجاوز أي متغير موجود بالفعل في بيئة التشغيل، ولا يُرفع أي سر مع المستودع.
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(file)) {
  fs.readFileSync(file, "utf8").split("\n").forEach((line) => {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  });
}
