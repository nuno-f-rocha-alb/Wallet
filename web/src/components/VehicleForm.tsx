import { useState } from 'react';
import type { Vehicle } from '@wallet/shared';
import { useDeleteVehicle, useSaveVehicle } from '../api';
import { btnDanger, btnGhost, btnPrimary, input, label } from './ui';

export function VehicleForm({ vehicle, onClose }: { vehicle?: Vehicle; onClose: () => void }) {
  const save = useSaveVehicle();
  const del = useDeleteVehicle();
  const editing = !!vehicle;

  const [name, setName] = useState(vehicle?.name ?? '');
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [plate, setPlate] = useState(vehicle?.plate ?? '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate(
      {
        id: vehicle?.id,
        name: name.trim(),
        make: make.trim() || null,
        plate: plate.trim() || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={label} htmlFor="v-name">Name</label>
        <input id="v-name" className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
      </div>
      <div>
        <label className={label} htmlFor="v-make">Make / model</label>
        <input id="v-make" className={input} value={make} onChange={(e) => setMake(e.target.value)} placeholder="VW Golf" />
      </div>
      <div>
        <label className={label} htmlFor="v-plate">Plate</label>
        <input id="v-plate" className={input} value={plate} onChange={(e) => setPlate(e.target.value)} />
      </div>

      {save.error && <p className="text-sm text-red-600">{save.error.message}</p>}
      {del.error && <p className="text-sm text-red-600">{del.error.message}</p>}

      <div className="flex items-center justify-between pt-2">
        {editing ? (
          <button type="button" className={btnDanger} onClick={() => del.mutate(vehicle.id, { onSuccess: onClose })}>
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
