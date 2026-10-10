# LAYA 인쇄 점검

길벗의 [인쇄 유의사항 8가지](https://blog.naver.com/gilbutzigy/223785925614)를 바탕으로 만든 Adobe 앱 내 점검 도구와 Codex 스킬입니다. 재단 안전 여백, 도련, 테두리, 작은 검정·회색 글자, 리치블랙, 글꼴, 이미지, 별색·RGB를 확인합니다.

## 바로 사용하기

[Adobe 점검 도구 ZIP](dist/adobe-print-preflight.zip)을 다운로드하고 압축을 풉니다. GitHub 파일 화면에서 **Download raw file**을 누르면 내려받을 수 있습니다.

### Illustrator

1. 점검할 문서를 엽니다.
2. **파일 → 스크립트 → 기타 스크립트…**를 선택합니다.
3. 압축을 푼 폴더의 **LAYA 인쇄 점검.jsx** 파일명을 클릭해 선택하고 **열기**를 누릅니다.
4. 인쇄소 기준을 입력하고 **점검 시작**을 누릅니다.

### InDesign

1. **창 → 유틸리티 → 스크립트**를 엽니다.
2. **사용자**를 우클릭해 Finder 또는 탐색기에서 폴더를 표시합니다.
3. 해당 Scripts Panel 폴더에 **LAYA 인쇄 점검.jsx**를 복사합니다.
4. 사용자 목록을 펼쳐 **LAYA 인쇄 점검.jsx**를 더블클릭합니다.
5. 기준을 입력하고 **점검 시작**을 누릅니다.

설정 창에서는 **취소**, 결과 창에서는 **닫기**를 누르면 닫힙니다. 같은 메뉴에서 다시 실행할 수 있습니다. 결과 항목을 선택하면 상세 설명이 표시되며 **보고서 저장**으로 TXT를 저장합니다.

자세한 기준과 설치 방법은 [Adobe 사용 방법](adobe-print-preflight/사용%20방법.md)에 있습니다. Adobe 도구 실행에는 Codex, LAYA 엔진, Python, 터미널이 필요하지 않습니다.

## 포함된 작업물

| 위치 | 내용 |
| --- | --- |
| `adobe-print-preflight/` | Illustrator·InDesign 실행 파일, 소스, 빌드 도구, 테스트, 사용 설명 |
| `skills/laya-print-preflight/` | Codex 인쇄 점검 스킬, 8가지 기준, PDF 부분 검사기와 테스트 |
| `skills/laya-mac-control/` | 기존 설치본에서 가져온 macOS 앱 실행 보조 스킬과 테스트 |
| `skills/laya-terminal/` | 터미널에서 앱 실행 및 LAYA 로컬 API를 조회하는 보조 스킬 |
| `dist/` | 다른 사람에게 전달할 Adobe 도구 및 인쇄 점검 스킬 ZIP |

Codex 스킬은 필요한 폴더를 개인 스킬 폴더에 복사해 사용합니다. 터미널 보조 스킬의 자연어 앱 실행에는 `laya-mac-control`이 함께 필요합니다. LAYA 로컬 API 조회에는 별도로 실행 중인 LAYA 엔진이 필요합니다.

## 확인 범위

현재 버전은 Adobe 안에서 창으로 실행하는 스크립트입니다. 원본을 자동으로 수정하거나 외부로 전송하지 않습니다. **확인됨 / 주의 / 확인 필요** 상태와 실제 수집한 근거를 표시합니다.

안전 여백은 기본 3mm, 이미지 기준은 기본 300PPI입니다. 원문에 수치가 없는 도련 폭, 작은 글자의 pt 경계와 리치블랙 배합을 임의로 확정하지 않습니다. 인쇄소 기준을 우선 적용합니다.

2026년 10월 10일 macOS의 InDesign 2026 및 Illustrator 2026에서 설정·결과 창 실행을 확인했습니다. InDesign 시험 문서에서는 재단선으로부터 0.68mm 떨어진 글자 프레임 후보를 주의로 표시하고 TXT 보고서 저장을 확인했습니다. 다른 Adobe 버전과 Windows의 Adobe 앱은 실행 확인이 필요합니다.

이 도구는 원본과 PDF의 부분 검사입니다. 최종 PDF의 도련 채움, 글꼴 포함, 분판, 인쇄소 사양까지 확인한 뒤 납품해야 합니다. 읽지 못한 객체와 범위는 추가 확인으로 남으며 인쇄 적합성이나 PDF/X를 인증하지 않습니다.

## PDF 검사기

Python 3와 `pypdf`가 필요합니다. 검사할 PDF 원본과 보고서 출력 경로는 다르게 지정합니다.

```sh
python3 -m pip install -r requirements.txt
python3 skills/laya-print-preflight/scripts/pdf_probe.py final-print.pdf --json preflight-evidence.json
```

보고서는 항상 `complete: false`이며 종료 코드 1은 추가 확인이 필요한 부분 검사 결과, 2는 입력·실행 오류입니다. 보고서의 근거와 추가 확인 항목을 함께 읽어야 합니다.

## 개발 및 테스트

Adobe 실행 파일은 네 가지 소스 파일을 하나로 합쳐 만듭니다. 빌드·테스트에는 Node.js가 필요합니다.

```sh
node adobe-print-preflight/build.cjs
node --test adobe-print-preflight/tests/*.test.cjs
python3 -m unittest discover -s skills/laya-print-preflight/tests -v
python3 -m unittest discover -s skills/laya-mac-control/tests -v
```

Adobe 테스트는 규칙 18개, InDesign 수집 25개, Illustrator 수집 21개를 확인합니다. PDF 검사기 테스트는 20개, Mac 앱 실행 보조 테스트는 5개입니다. 자동 테스트와 실제 Adobe 실행 확인의 범위는 서로 다릅니다.

## 라이선스와 출처

이 프로젝트의 구현은 [MIT 라이선스](LICENSE)로 제공합니다. 포함된 `laya-mac-control`의 기존 저작권 표시는 [해당 라이선스](skills/laya-mac-control/LICENSE)에 보존되어 있습니다. 원문 글, Adobe 상표와 외부 문서는 각 권리자의 소유입니다. 원문 전체나 사용자 작업 파일·보고서는 배포에 포함하지 않습니다.

- [길벗 인쇄 유의사항 8가지](https://blog.naver.com/gilbutzigy/223785925614)
- [Adobe InDesign 스크립트 패널](https://helpx.adobe.com/indesign/desktop/automation-and-scripting/document-automation/automate-workflows-with-scripts.html)
- [Adobe Illustrator 스크립트 실행](https://helpx.adobe.com/illustrator/desktop/automate-visualize-data/automate-actions/install-and-run-scripts.html)
