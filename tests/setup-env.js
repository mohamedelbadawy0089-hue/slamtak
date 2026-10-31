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
      let value = line.slice(i + 1).trim();
      // تكافؤ علامتن التنصيص المحيطة ('...' أو "...")
      if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      if (key && !process.env[key]) process.env[key] = value;
    }
  });
}
// الرابط العام لمشروع Supabase ليس سراً — يُستخدم كبديل إذا أعادت المنصة كتابتها
// ملف .env.local وفقده (يجعل اختبارات التكامل مقاومة لتجديد الملف)
if (!process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = "https://iksjhjxwphmvthryfeae.supabase.co";
}
