import React, { useEffect, useState } from "react";
import { Card, Table, Button, Badge, Alert } from "react-bootstrap";
import { LineChart, BarChart, Line, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import arabicNumber from "../utils/arabicNumbers";

interface FinancialReportData {
  period: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netIncome: number;
}

interface BalanceSheetData {
  asOfDate: string;
  assetsTotal: number;
  currentAssets: number;
  fixedAssets: number;
  accumulatedDepreciation: number;
  netFixedAssets: number;
  liabilitiesTotal: number;
  currentLiabilities: number;
  equity: number;
  retainedEarnings: number;
}

export const FinancialReportsPage: React.FC = () => {
  const [reports, setReports] = useState<FinancialReportData[]>([]);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadReports = async () => {
      try {
        setLoading(true);
        // Fetch income statement data from API
        const rs = await fetch("/api/reports/income-statement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            p_start_date: new Date(new Date().setMonth(0)).toISOString().split("T")[0],
            p_end_date: new Date().toISOString().split("T")[0],
          }),
        });

        if (!rs.ok) throw new Error("Failed to fetch income statement");
        const incomeData = await rs.json();
        setReports(incomeData.data || []);

        // Fetch balance sheet data
        const bs = await fetch("/api/reports/balance-sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ p_as_of_date: new Date().toISOString().split("T")[0] }),
        });
        if (!bs.ok) throw new Error("Failed to fetch balance sheet");
        const bsData = await bs.json();
        setBalanceSheet(bsData.data || null);
        setLoading(false);
      } catch (err: any) {
        setError(err.message);
        console.error("Financial reports error:", err);
        setLoading(false);
      }
    };

    loadReports();
  }, []);

  if (loading) return <Alert variant="info">جاري تحميل تقاريرالمالية...</Alert>;
  if (error) return <Alert variant="danger">حدث خطأ: {error}</Alert>;

  return (
    <div dir="rtl" className="p-4">
      <h2 className="mb-4 text-primary">التقارير المالية</h2>

      {/* Income Statement Section */}
      <Card key="income-statement" className="mb-4">
        <Card.Header>
          <Card.Title>قائمة الدخل - Income Statement</Card.Title>
        </Card.Header>
        <Card.Body>
          {reports.length === 0 && <p>لا توجد بيانات للفترة المحددة</p>}
          {reports.length > 0 && (
            <>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={reports}>
                <XAxis dataKey="period" strokeDasharray="5 3" label={{ value: "الفترة", position: "bottom" }} />
                <YAxis label={{ value: "المبلغ (EGP)", position: "left" }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="revenue" name="الإيرادات" fill="#8884d8" />
                <Bar dataKey="cogs" name="تكلفة البضاعة المباعة" fill="#82ca9d" />
                <Bar dataKey="grossProfit" name="الربح الإجمالي" fill="#f6e05e" />
                <Bar dataKey="operatingExpenses" name="المصاريف التشغيلية" fill="#ff6384" />
                <Bar dataKey="netIncome" name="صافي الدخل" fill="#36a2eb" />
              </BarChart>
            </ResponsiveContainer>
            <Table striped bordered hover className="mt-3">
              <thead>
                <tr>
                  <th>الفترة</th>
                  <th>الإيرادات</th>
                  <th>تكلفة البضاعة</th>
                  <th>الربح الإجمالي</th>
                  <th>المصاريف</th>
                  <th>صافي الدخل</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((row) => (
                  <tr key={row.period}>
                    <td>{arabicNumber(row.period)}</td>
                    <td>{arabicNumber(row.revenue.toLocaleString())}</td>
                    <td>{arabicNumber(row.cogs.toLocaleString())}</td>
                    <td>{arabicNumber(row.grossProfit.toLocaleString())}</td>
                    <td>{arabicNumber(row.operatingExpenses.toLocaleString())}</td>
                    <td>{arabicNumber(row.netIncome.toLocaleString())}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            </>
          )}
        </Card.Body>
      </Card>

      {/* Balance Sheet Section */}
      {balanceSheet && (
        <Card key="balance-sheet" className="mt-4">
          <Card.Header>
            <Card.Title>الميزانية العمومية - Balance Sheet</Card.Title>
          </Card.Header>
          <Card.Body>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={[{ ...balanceSheet }]} dataKey="value">
                <XAxis dataKey="key" label={{ value: "البنود", position: "bottom" }} />
                <YAxis label={{ value: "المبلغ (EGP)", position: "left" }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="value" stroke="#8884d8" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
            <Table striped bordered hover className="mt-3">
              <thead>
                <tr>
                  <th>البند</th>
                  <th>المبلغ</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>إجمالي الأصول</td>
                  <td>{arabicNumber(balanceSheet.assetsTotal.toLocaleString())}</td>
                </tr>
                <tr>
                  <td>الأصول الحالية</td>
                  <td>{arabicNumber(balanceSheet.currentAssets.toLocaleString())}</td>
                </tr>
                <tr>
                  <td>الأصول الثابتة</td>
                  <td>{arabicNumber(balanceSheet.fixedAssets.toLocaleString())}</td>
                </tr>
                <tr>
                  <td>الإهلاك التراكمي</td>
                  <td>{arabicNumber(balanceSheet.accumulatedDepreciation.toLocaleString())}</td>
                </tr>
                <tr>
                  <td>الأصول الثابتة الصافية</td>
                  <td>{arabicNumber(balanceSheet.netFixedAssets.toLocaleString())}</td>
                </tr>
                <tr>
                  <td>إجمالي الالتزامات</td>
                  <td>{arabicNumber(balanceSheet.liabilitiesTotal.toLocaleString())}</td>
                </tr>
                <tr>
                  <td>الالتزامات الحالية</td>
                  <td>{arabicNumber(balanceSheet.currentLiabilities.toLocaleString())}</td>
                </tr>
                <tr>
                  <td>حقوق الملكية</td>
                  <td>{arabicNumber(balanceSheet.equity.toLocaleString())}</td>
                </tr>
                <tr>
                  <td>الأرباح المحتجزة</td>
                  <td>{arabicNumber(balanceSheet.retainedEarnings.toLocaleString())}</td>
                </tr>
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}
    </div>
  );
};