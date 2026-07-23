import { useState } from 'react';
import type { FuelEntry } from '@wallet/shared';
import { useDeleteFuel, useSaveFuel } from '../api';
import { toCents, toMl, todayISO } from '../format';
import { btnDanger, btnGhost, btnPrimary, input, label } from './ui';

export function FuelForm({
  vehicleId,
  entry,
  onClose,
}: {
  vehicleId: number;
  entry?: FuelEntry;
  onClose: () => void;
}) {
  const save = useSaveFuel();
  const del = useDeleteFuel();
  const editing = !!entry;

  const [date, setDate] = useState(entry?.date ?? todayISO());
  const [odometer, setOdometer] = useState(entry ? String(entry.odometerKm) : '');
  const [liters, setLiters] = useState(entry ? (entry.litersMl / 1000).toString() : '');
  const [price, setPrice] = useState(entry ? (entry.totalPriceCents / 100).toString() : '');
  const [isFull, setIsFull] = useState(entry?.isFull ?? true);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const odo = Math.round(Number(odometer));
    const ml = toMl(Number(liters));
    if (!(odo > 0) || !(ml > 0)) return;
    save.mutate(
      {
        id: entry?.id,
        vehicleId,
        date,
        odometerKm: odo,
        litersMl: ml,
        totalPriceCents: toCents(Number(price) || 0),
        isFull,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={label} htmlFor="f-date">Date</label>
        <input id="f-date" className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div>
        <label className={label} htmlFor="f-odo">Odometer (km)</label>
        <input id="f-odo" className={input} type="number" inputMode="numeric" step="1" min="1" value={odometer} onChange={(e) => setOdometer(e.target.value)} required />
      </div>
      <div>
        <label className={label} htmlFor="f-liters">Litres</label>
        <input id="f-liters" className={input} type="number" inputMode="decimal" step="0.01" min="0.01" value={liters} onChange={(e) => setLiters(e.target.value)} required />
      </div>
      <div>
        <label className={label} htmlFor="f-price">Total price (€)</label>
        <input id="f-price" className={input} type="number" inputMode="decimal" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={isFull} onChange={(e) => setIsFull(e.target.checked)} className="h-4 w-4" />
        Full tank (used for L/100km)
      </label>

      {save.error && <p className="text-sm text-red-600">{save.error.message}</p>}
      {del.error && <p className="text-sm text-red-600">{del.error.message}</p>}

      <div className="flex items-center justify-between pt-2">
        {editing ? (
          <button type="button" className={btnDanger} onClick={() => del.mutate(entry.id, { onSuccess: onClose })}>
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={save.isPending}>{editing ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </form>
  );
}
