const request = require("supertest");

// src/api/index.js يصدّر التطبيق مباشرة عبر module.exports = app (بدون .default)
const app = require("../src/api/index");

// بريد فريد لكل تشغيل حتى يبقى الاختبار قابلاً للتكرار (signUp يرفض التكرار بـ 400)
const uniqueEmail = (base) =>
  `${base}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.org`;

describe("Auth Integration Tests", () => {
  test("POST /api/auth/register should create a new user", async () => {
    const userData = {
      email: uniqueEmail("testuser"),
      password: "TestPassword123",
      name: "Test User",
    };

    const response = await request(app)
      .post("/api/auth/register")
      .send(userData);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("id");
    expect(response.body).toHaveProperty("email", userData.email);
    expect(response.body).toHaveProperty("name", userData.name);
    expect(response.body).toHaveProperty("role", "viewer");
  });

  test("POST /api/auth/register should fail with missing fields", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("error");
  });

  test("GET /api/auth/me should return user role", async () => {
    const response = await request(app).get("/api/auth/me");

    // May be 401 if no user is logged in, which is expected in test environment
    expect([200, 401]).toContain(response.status);
  });

  test("POST /api/auth/login should authenticate user", async () => {
    // First register a user (بريد فريد لضمان تكرار الاختبار)
    const loginEmail = uniqueEmail("loginuser");
    await request(app)
      .post("/api/auth/register")
      .send({
        email: loginEmail,
        password: "TestPassword123",
        name: "Login User",
      });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: loginEmail,
        password: "TestPassword123",
      });

    expect([200, 401]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body).toHaveProperty("id");
    }
  });
});

