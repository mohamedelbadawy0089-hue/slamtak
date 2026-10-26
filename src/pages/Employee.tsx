import React from 'react';

export const Employee: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-purple-600 text-white p-4">
        <h1 className="text-xl font-bold">Employee Panel</h1>
      </header>

      <main className="p-6">
        <h2 className="text-2xl font-bold mb-6">Daily Operations</h2>

        <div className="grid grid-cols-1 gap-4 mb-6">
          <div className="padding bg-white rounded shadow p-4">
            <h3>Stock Management</h3>
            <p>Record inventory movements</p>
          </div>
          <div className="padding bg-white rounded shadow p-4">
            <h3>Product Lookup</h3>
            <p>Search and view product details</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="padding bg-white rounded shadow p-4">
            <h3>Order Processing</h3>
            <p>Process customer orders</p>
          </div>
          <div className="padding bg-white rounded shadow p-4">
            <h3>Reports</h3>
            <p>View daily sales and activity</p>
          </div>
        </div>
      </main>
    </div>
  );
};