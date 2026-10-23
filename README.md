# VRChat 프린트 자르기

## 기능

- VRChat 카메라 프린트에서 흰 프레임과 캡션을 잘라 사진만 남긴다.
- 90° 회전, 좌우 반전, 밝기·대비·채도·색온도 보정을 한다.
- 결과는 무손실 PNG이고, 연 파일의 XMP 메타데이터(월드, 촬영자, 날짜)를 그대로 유지한다.
- 모든 처리는 브라우저 안에서 하며 이미지를 업로드하지 않는다.

사이트: https://kamyu1537.github.io/vrc-print-cropper/

## 사용

1. 이미지를 끌어다 놓거나 "이미지 열기"를 눌러 여러 장을 연다.
2. 목록에서 이미지를 고르고 회전·반전하거나 슬라이더를 움직인다.
3. "PNG로 저장"을 누른다. 프린트는 `<이름>_crop.png`, 그 밖의 이미지는 `<이름>_edit.png` 로 저장된다.

프린트는 크기가 2048x1440이고 위·왼쪽·오른쪽 여백이 순수한 흰색인 이미지다. 그 밖의 이미지는 자르지 않는다.

## 개발

```bash
pnpm install
pnpm exec playwright install chromium
pnpm run dev
```

| 명령 | 하는 일 |
| --- | --- |
| `pnpm run typecheck` | 타입 검사 |
| `pnpm run lint` | ESLint |
| `pnpm run test` | node와 브라우저(Chromium) 테스트 |
| `pnpm run build` | `dist/` 에 빌드 |

main에 푸시하면 GitHub Actions가 검사, 테스트, 빌드를 거쳐 GitHub Pages에 배포한다.

설계는 [docs/architecture.md](docs/architecture.md), 화면 규칙은 [docs/design.md](docs/design.md), 용어는 [GLOSSARY.md](GLOSSARY.md)에 있다.
