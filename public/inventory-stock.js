// ============================================================
// مخزون مشترك: زيادة رصيد inventory وتسجيل الحركة في مكان واحد
// تستخدمه purchases-invoices.js و purchases-receiving.js
// ============================================================

(function() {
  'use strict';

  var RETRIES = 5;

  function newId(prefix) {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // زيادة ذرّية بمقارنة‑وتبديل: التحديث يقع فقط إذا بقيت الكمية كما قرأناها،
  // وإلا تُعاد القراءة، فلا تُطمس كمية استلام متزامن.
  async function increment(client, productId, warehouseId, delta, unitOfMeasure, now) {
    for (var attempt = 0; attempt < RETRIES; attempt++) {
      var read = await client
        .from('inventory')
        .select('id,quantity')
        .eq('product_id', productId)
        .eq('warehouse_id', warehouseId)
        .maybeSingle();

      if (read.error) return { id: null, error: read.error };

      if (!read.data) {
        var created = newId('INV');
        var inserted = await client.from('inventory').insert({
          id: created,
          product_id: productId,
          warehouse_id: warehouseId,
          quantity: delta,
          unit_of_measure: unitOfMeasure,
          last_counted_at: now,
        });
        if (!inserted.error) return { id: created, error: null };
        // 23505 = صف أُنشئ بين القراءة والإدراج؛ نعيد المحاولة كتحديث.
        if (inserted.code !== '23505') return { id: null, error: inserted.error };
        continue;
      }

      var updated = await client
        .from('inventory')
        .update({ quantity: (Number(read.data.quantity) || 0) + delta, last_counted_at: now })
        .eq('id', read.data.id)
        .eq('quantity', read.data.quantity)
        .select('id');

      if (updated.error) return { id: null, error: updated.error };
      if (updated.data && updated.data.length) return { id: read.data.id, error: null };
    }

    return { id: null, error: new Error('تعذر تحديث الرصيد: تغيّر متزامن متكرر') };
  }

  // دالة واحدة لكل بند استلام: تزيد الرصيد ثم تسجّل الحركة،
  // ولا تُسجَّل الحركة إن فشل الرصيد (فلا سجل يخالف الأرصدة).
  async function applyIn(client, options) {
    var now = options.now || new Date().toISOString();
    var unit = options.unitOfMeasure || 'piece';
    var stock = await increment(client, options.productId, options.warehouseId, Number(options.quantity) || 0, unit, now);

    if (stock.error) return { error: stock.error, inventoryId: null };

    var movement = await client.from('inventory_movements').insert({
      id: newId('IME'),
      inventory_id: stock.id,
      product_id: options.productId,
      warehouse_id: options.warehouseId,
      movement_type: 'in',
      quantity: Number(options.quantity) || 0,
      unit_of_measure: unit,
      source_type: options.sourceType || 'goods_receipt',
      source_id: options.sourceId || null,
      reference_number: options.referenceNumber || options.sourceId || null,
      created_by: options.createdBy || null,
      created_at: now,
      notes: options.notes || null,
    });

    return { error: movement.error || null, inventoryId: stock.id };
  }

  window.SlamtakStock = { increment: increment, applyIn: applyIn };
})();
