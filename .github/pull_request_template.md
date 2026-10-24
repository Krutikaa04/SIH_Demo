## Summary

Describe the problem and resulting behavior. Link the issue with `Closes #...`.

## Validation

List commands and results. Include screenshots for visible UI changes and mention
material limitations. For a stacked PR, identify its prerequisite and merge order.

## Checklist

- [ ] Scope is limited to the linked issue.
- [ ] Backend tests pass: `python -m pytest backend/tests -q`.
- [ ] Frontend checks pass where relevant: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- [ ] Demo smoke test passes: `python scripts/ci_smoke.py`.
- [ ] Documentation reflects changed behavior and commands.
- [ ] Generated UI changes follow the existing dist policy until issue #7 is decided.
- [ ] No databases, uploads, environments, wheelhouses or archives are committed.
- [ ] Commit messages and source changes contain no attribution trailers or unrelated comments.
