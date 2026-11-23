# Data provenance and inspection guide

Every heritage vehicle parameter and engine record in `data/vehicles/` and `data/engines/` wraps its scalar or string value inside `ProvenanceValue<T>`.

## Schema structure

Each field contains:

- `value`: Canonical SI metric scalar or string identifier.
- `canonical_unit`: SI unit string (such as `"kg"`, `"m"`, `"N"`, `"s"`, `"bar"`, `"USD"`).
- `status`: Verification classification (`primary_source`, `derived`, `estimated`, or `nominal_placeholder`).
- `citation`: Optional bibliographic reference linking to `data/citations/bibliography.json` (`document_title`, `publisher`, `publication_year`, `page_number`, `direct_url`, `excerpt`).
- `derivation`: Optional `Derivation` record for derived or parametric values (`governing_equation`, `input_parameters`, `assumptions`, `solver_method`, `confidence_rating`).

## Interactive inspection workflow

1. Open **Heritage Vehicles** or **Heritage Engines** (or click underlined KPI values in **Sizing Studio**).
2. Click any outlined table cell to open the right-hand **Provenance Inspector** drawer.
3. Inspect the primary source excerpt, source link, governing equation, input parameter breakdown, and solver assumptions.
4. Submit a user correction and rationale inside the drawer to update active model parameters in memory during trade studies.

## Related Documentation

- [Project Overview](../README.md)
- [User Guide](USER_GUIDE.md)
- [Model Validation](MODEL_VALIDATION.md)
- [Third-Party Notices](../THIRD_PARTY_NOTICES.md)
- [Security Policy](../SECURITY.md)
