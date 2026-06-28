import { useMemo, useState } from 'react';
import type { District, Team } from '../domain/types';
import {
  districtIdSlug,
  isDistrictActive,
  validateDistrictInput,
  countTeamsForDistrict,
  type DistrictMaintenanceInput,
  type DistrictUpdatePatch,
} from '../engine/districtRegistry';

/**
 * Completion Milestone C2: the District Maintenance screen.
 *
 * A thin renderer over the pure C1 registry helpers. It lists EVERY district (active and
 * inactive — inactive are never hidden here), and lets the user add a district, edit its
 * mutable fields, and inactivate/reactivate it. It NEVER deletes a district and NEVER edits a
 * districtId (the id is generated deterministically on create and is stable forever). All
 * changes flow up to the app, which writes them into committed `workspace.districts` so they
 * auto-save (A1), export/import (A2), and feed scraped-import mapping (C3/B2) immediately.
 *
 * Image handling is string references only — there is deliberately no upload / file picker /
 * asset browser. Matching stays exact (no fuzzy aliases).
 */

type DistrictFilter = 'all' | 'active' | 'inactive';

type FormState = {
  name: string;
  mascot: string;
  primaryColor: string;
  secondaryColor: string;
  logoAssetPath: string;
  helmetAssetPath: string;
  /** Comma- or newline-separated exact import aliases. */
  sourceLabels: string;
  brandingProvisional: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  mascot: '',
  primaryColor: '',
  secondaryColor: '',
  logoAssetPath: '',
  helmetAssetPath: '',
  sourceLabels: '',
  brandingProvisional: true,
};

function parseSourceLabelsField(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function formForDistrict(d: District): FormState {
  return {
    name: d.name,
    mascot: d.mascot,
    primaryColor: d.primaryColor,
    secondaryColor: d.secondaryColor,
    logoAssetPath: d.logoAssetPath,
    helmetAssetPath: d.helmetAssetPath,
    sourceLabels: (d.sourceLabels ?? []).join(', '),
    brandingProvisional: d.brandingProvisional ?? false,
  };
}

function ColorChip({ color }: { color: string }) {
  if (!color) return <span className="district-color-none">—</span>;
  return (
    <span className="district-color-chip">
      <span className="district-color-swatch" style={{ backgroundColor: color }} aria-hidden="true" />
      <code>{color}</code>
    </span>
  );
}

export default function DistrictMaintenanceView({
  districts,
  teams,
  onCreate,
  onUpdate,
  onInactivate,
  onReactivate,
}: {
  districts: District[];
  teams: Team[];
  onCreate: (input: DistrictMaintenanceInput) => void;
  onUpdate: (districtId: string, patch: DistrictUpdatePatch) => void;
  onInactivate: (districtId: string) => void;
  onReactivate: (districtId: string) => void;
}) {
  const [filter, setFilter] = useState<DistrictFilter>('all');
  // null = create mode; a districtId = editing that district.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);

  const visible = useMemo(() => {
    return districts.filter((d) => {
      if (filter === 'active') return isDistrictActive(d);
      if (filter === 'inactive') return !isDistrictActive(d);
      return true;
    });
  }, [districts, filter]);

  const activeCount = districts.filter(isDistrictActive).length;
  const inactiveCount = districts.length - activeCount;

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors([]);
  }

  function startEdit(d: District) {
    setEditingId(d.districtId);
    setForm(formForDistrict(d));
    setErrors([]);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const input: DistrictMaintenanceInput = {
      name: form.name,
      mascot: form.mascot,
      primaryColor: form.primaryColor,
      secondaryColor: form.secondaryColor,
      logoAssetPath: form.logoAssetPath,
      helmetAssetPath: form.helmetAssetPath,
      sourceLabels: parseSourceLabelsField(form.sourceLabels),
      brandingProvisional: form.brandingProvisional,
    };
    const validation = validateDistrictInput(input);
    if (validation.length > 0) {
      setErrors(
        validation.map((code) =>
          code === 'missing-name' ? 'District name is required.' : 'Mascot is required.'
        )
      );
      return;
    }
    if (editingId) {
      const patch: DistrictUpdatePatch = {
        name: input.name,
        mascot: input.mascot,
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        logoAssetPath: input.logoAssetPath,
        helmetAssetPath: input.helmetAssetPath,
        sourceLabels: input.sourceLabels,
        brandingProvisional: input.brandingProvisional,
      };
      onUpdate(editingId, patch);
    } else {
      onCreate(input);
    }
    startCreate();
  }

  const idPreview = form.name.trim() ? districtIdSlug(form.name) : '';

  return (
    <div className="district-maintenance">
      <div className="import-preview-header">
        <h2 className="import-title">District Maintenance</h2>
        <span className="import-tag">{activeCount} active · {inactiveCount} inactive</span>
      </div>
      <p className="import-note">
        Manage the district registry used across the app. Changes <strong>auto-save to this
        browser</strong> (IndexedDB) and are included in an exported dataset. Active districts
        are matched by scraped imports immediately; <strong>inactive districts are preserved
        for history but ignored for new import matching</strong>. Districts are never deleted —
        inactivate is the only way to retire one. Logo/helmet fields are filename/path
        references only (no uploads).
      </p>

      <div className="district-maintenance-body">
        <div className="district-list-pane">
          <div className="district-filter">
            <span>Show:</span>
            {(['all', 'active', 'inactive'] as DistrictFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                className={`app-nav-button ${filter === f ? 'app-nav-button-active' : ''}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="import-empty">No districts to show for this filter.</p>
          ) : (
            <table className="import-table district-table">
              <thead>
                <tr>
                  <th>District</th>
                  <th>ID</th>
                  <th>Mascot</th>
                  <th>Status</th>
                  <th>Colors</th>
                  <th>Logo / Helmet</th>
                  <th>Aliases</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => {
                  const active = isDistrictActive(d);
                  return (
                    <tr key={d.districtId} className={editingId === d.districtId ? 'district-row-editing' : ''}>
                      <td>
                        {d.name}
                        {d.brandingProvisional && (
                          <span className="district-flag" title="Branding is placeholder/provisional">
                            {' '}⚑ provisional
                          </span>
                        )}
                      </td>
                      <td><code>{d.districtId}</code></td>
                      <td>{d.mascot || '—'}</td>
                      <td>
                        <span className={`import-badge import-badge-${active ? 'ready' : 'blocked'}`}>
                          {active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <ColorChip color={d.primaryColor} /> <ColorChip color={d.secondaryColor} />
                      </td>
                      <td className="district-asset-cell">
                        <div>{d.logoAssetPath || '—'}</div>
                        <div>{d.helmetAssetPath || '—'}</div>
                      </td>
                      <td>{(d.sourceLabels ?? []).join(', ') || '—'}</td>
                      <td className="district-actions">
                        <button type="button" className="import-link-button" onClick={() => startEdit(d)}>
                          Edit
                        </button>
                        {active ? (
                          <button
                            type="button"
                            className="import-link-button"
                            onClick={() => onInactivate(d.districtId)}
                          >
                            Inactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="import-link-button"
                            onClick={() => onReactivate(d.districtId)}
                          >
                            Reactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <form className="district-form" onSubmit={handleSubmit}>
          <div className="import-section-head">
            <h3>{editingId ? `Edit district: ${editingId}` : 'Add a district'}</h3>
            {editingId && (
              <button type="button" className="import-link-button" onClick={startCreate}>
                Cancel edit
              </button>
            )}
          </div>

          {editingId && referencedWarning(teams, editingId)}

          <div className="filter-group">
            <label htmlFor="district-name">Name *</label>
            <input
              id="district-name"
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
            />
            {!editingId && idPreview && (
              <span className="district-id-preview">
                Will be saved with an id like <code>{idPreview}</code> (auto-generated;
                disambiguated if it collides).
              </span>
            )}
          </div>
          <div className="filter-group">
            <label htmlFor="district-mascot">Mascot *</label>
            <input
              id="district-mascot"
              type="text"
              value={form.mascot}
              onChange={(e) => setField('mascot', e.target.value)}
            />
          </div>
          <div className="district-form-row">
            <div className="filter-group">
              <label htmlFor="district-primary">Primary color</label>
              <input
                id="district-primary"
                type="text"
                placeholder="#3581B8"
                value={form.primaryColor}
                onChange={(e) => setField('primaryColor', e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label htmlFor="district-secondary">Secondary color</label>
              <input
                id="district-secondary"
                type="text"
                placeholder="#EBE9E9"
                value={form.secondaryColor}
                onChange={(e) => setField('secondaryColor', e.target.value)}
              />
            </div>
          </div>
          <div className="filter-group">
            <label htmlFor="district-logo">Logo asset path (filename/reference)</label>
            <input
              id="district-logo"
              type="text"
              placeholder="districts/alta-logo.png"
              value={form.logoAssetPath}
              onChange={(e) => setField('logoAssetPath', e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label htmlFor="district-helmet">Helmet asset path (filename/reference)</label>
            <input
              id="district-helmet"
              type="text"
              placeholder="districts/alta-helmet.png"
              value={form.helmetAssetPath}
              onChange={(e) => setField('helmetAssetPath', e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label htmlFor="district-aliases">
              Exact import aliases (comma or newline separated)
            </label>
            <textarea
              id="district-aliases"
              rows={2}
              value={form.sourceLabels}
              onChange={(e) => setField('sourceLabels', e.target.value)}
            />
            <span className="district-id-preview">
              Matched exactly against scraped district labels (never fuzzy). Defaults to the
              district name when left blank.
            </span>
          </div>
          <div className="filter-group district-checkbox">
            <label htmlFor="district-provisional">
              <input
                id="district-provisional"
                type="checkbox"
                checked={form.brandingProvisional}
                onChange={(e) => setField('brandingProvisional', e.target.checked)}
              />
              {' '}Branding is placeholder/provisional
            </label>
          </div>

          {errors.length > 0 && (
            <ul className="import-issues">
              {errors.map((message, i) => (
                <li key={i} className="import-issue import-issue-error">{message}</li>
              ))}
            </ul>
          )}

          <button type="submit" className="import-decision-button import-commit-button">
            {editingId ? 'Save changes' : 'Add district'}
          </button>
        </form>
      </div>
    </div>
  );
}

function referencedWarning(teams: Team[], districtId: string) {
  const count = countTeamsForDistrict(teams, districtId);
  if (count === 0) return null;
  return (
    <p className="import-reasons">
      {count} team{count === 1 ? '' : 's'} reference this district. Editing keeps its id, so
      those rosters stay attached; inactivating it does not detach or change them — it only
      stops new imports from matching this district.
    </p>
  );
}
