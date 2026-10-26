import React from 'react';

export const SuperAdmin: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-blue-600 text-white p-4">
        <h1 className="text-xl font-bold">Super Admin Panel</h1>
      </header>

      <main className="p-6">
        <h2 className="text-2xl font-bold mb-6">System Management</h2>

        <div className="grid grid-cols-1 gap-4 mb-6">
          <div className="padding bg-white rounded shadow p-4">
            <h3>User Management</h3>
            <p>Manage all users and roles</p>
          </div>
          <div className="padding bg-white rounded shadow p-4">
            <h3>Inventory Overview</h3>
            <p>View and adjust all product stock</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="padding bg-white rounded shadow p-4">
            <h3>Financial Reports</h3>
            <p>View average costs and revenue</p>
          </div>
          <div className="padding bg-white rounded shadow p-4">
            <h3>System Settings</h3>
            <p>Configure application settings</p>
          </div>
        </div>
      </main>
    </div>
  );
};