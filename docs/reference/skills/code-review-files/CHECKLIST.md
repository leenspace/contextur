# SuperApp Retail Review Checklist

Use this as a quick reference when applying the code-review-files skill. Full authority: `docs/rules.md`.

## Architecture

- [ ] Presentation uses only Use Cases (no direct repository/data access)
- [ ] Domain has no dependency on Data or Presentation
- [ ] No feature-to-feature dependency (`packages/features/*` → `packages/features/*`)
- [ ] Cross-feature: UI Composition or Action + UseCaseGateway (contracts in core)
- [ ] Code in `lib/src/`; barrel exports only public API (no DTOs, DataSources, internals)

## State

- [ ] BLoC/Cubit with `ResultState<T>` (Initial, Loading, Data, Error)
- [ ] State/events with freezed (sealed), not Equatable
- [ ] Single use case → state is `ResultState<T>`; multiple → state model with multiple `ResultState` fields

## Data & DI

- [ ] get_it + injectable; depend on abstractions from core
- [ ] DTOs: freezed + json_serializable, `fieldRename: FieldRename.snake`

## Flutter & quality

- [ ] No `print`; use `logging`
- [ ] Fixed versions in pubspec (no `^`); fvm for Flutter/Dart
- [ ] very_good_analysis compliant (no fatal infos)
- [ ] No AI slop: no extra comments, no unnecessary try/catch, no dynamic casts
