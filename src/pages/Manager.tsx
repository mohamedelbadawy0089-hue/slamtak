import React from 'react';

export const Manager: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-green-600 text-white p-4">
        <h1 className="text-xl font-bold">Manager Panel</h1>
      </header>

      <main className="p-6">
        <h2 className="text-2xl font-bold mb-6">Inventory Management</h2>

        <div className="grid grid-cols-1 gap-4 mb-6">
          <div className="padding bg-white rounded shadow p-4">
            <h3>Stock Adjustment</h3>
            <p>Add or remove stock from products</p>
          </div>
          <div className="padding bg-white rounded shadow p-4">
            <h3>Low Stock Alerts</h3>
            <p>View products below minimum stock</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="padding bg-white rounded shadow p-4">
            <h3>Product Details</h3>
            <p>View and edit product information</p>
          </div>
          <div className="padding bg-white rounded shadow p-4">
            <h3>Cost Analysis</h3>
            <p>View average costs and profitability</p>
          </div>
        </div>
      </main>
    </div>
  );
};