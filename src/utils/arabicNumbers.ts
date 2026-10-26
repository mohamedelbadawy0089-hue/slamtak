// تحويل الأرقام إلى الأرقام العربية الهندية (٠١٢٣٤٥٦٧٨٩).
// بديل محلي بسيط: الحزمة arabic-numbers غير موجودة في سجل npm، والملف القديم
// كان يستوردها فتسقط عملية البناء (tsc) بسبب خطأ TS2307.
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export default function arabicNumber(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)]);
}
