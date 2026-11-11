"""
Calcule la position des cases des imprimés officiels 2031-SD et 2033-SD (millésime 2026) pour la liasse PDF.

Entrée : les PDF officiels (impots.gouv.fr), leur texte positionné (pdftotext -bbox) et un rendu à 288 dpi
(pdftoppm -r 288 -gray). Pour chaque numéro de case, la case de saisie est la cellule délimitée par les deux
filets verticaux qui suivent le numéro sur sa ligne. Sortie : src/domain/cerfaLayout.ts (coordonnées PDF).

Usage : python3 scripts/cerfa_layout.py <dossier contenant 2031-sd_5396.pdf, 2033-sd_5394.pdf, bbox*.html, r*.png>
"""
import html, json, re, sys
from PIL import Image

D = sys.argv[1]
H = 841.89
K = 4.0  # 288 dpi / 72

def words(src, page):
    p = open(f'{D}/{src}').read().split('<page ')[1:][page]
    return [(float(a), float(b), float(c), float(d), html.unescape(t)) for a, b, c, d, t in
            re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', p)]

class Page:
    def __init__(self, png):
        self.im = Image.open(f'{D}/{png}').convert('L')
        self.px = self.im.load()
        self.w, self.h = self.im.size
    def runs(self, y_pt, x_from, x_to=590.0, dark=150):
        """Filets verticaux croisant la ligne y (abscisses en points), de x_from à x_to."""
        y = int(y_pt * K)
        out, start = [], None
        for x in range(int(x_from * K), min(self.w, int(x_to * K))):
            # filet : sombre sur 5 pixels de haut (évite les lettres)
            d = all(self.px[x, yy] < dark for yy in range(y - 2, y + 3))
            if d and start is None: start = x
            if not d and start is not None:
                if x - start <= 8: out.append((start + x) / 2 / K)
                start = None
        return out

def cell_after(pg, x_end, yc, skip=0):
    """Cellule de saisie après un numéro de case : entre le 1er et le 2e filet qui suivent (skip : cellules à sauter)."""
    r = pg.runs(yc, x_end + 0.5)
    r = [x for i, x in enumerate(r) if i == 0 or x - r[i - 1] > 3]
    if len(r) < 2 + skip: return None
    return r[skip], r[skip + 1]

def slot(x0, x1, yc):
    # [x gauche, x droite, ligne de base] en coordonnées PDF
    return [round(x0, 1), round(x1, 1), round(H - yc - 2.6, 1)]

layout = {'2033': {}, '2031': {}}

# ------------------------------------------------------------------ 2033 : pages A à G
for pi, key in enumerate('ABCDEFG'):
    pg = Page(f'r2033-{pi + 1}.png')
    ws = words('bbox2033.html', pi)
    boxes = {}
    for x0, y0, x1, y1, t in ws:
        if not re.fullmatch(r'\d{3}', t) or t == '302': continue
        yc = (y0 + y1) / 2
        c = cell_after(pg, x1, yc)
        if c: boxes[t] = slot(c[0], c[1], yc)
        if key == 'A' and x0 > 370 and x0 < 380:  # colonne Net (sans numéro) après les amortissements
            n = cell_after(pg, x1, yc, skip=1)
            if n: boxes['net' + t] = slot(n[0], n[1], yc)
    page = {'boxes': boxes}
    for x0, y0, x1, y1, t in ws:
        yc = (y0 + y1) / 2
        if t == 'Néant':
            c = cell_after(pg, x1, yc, skip=0) or (x1 + 2, x1 + 12)
            page['neant'] = slot(x1 + 2, x1 + 14, yc)
        if t == 'Désignation' and 'name' not in page:
            page['name'] = [round(x1 + 70, 1), round(H - yc - 2.6, 1)]
    if key == 'A':
        sx = [w for w in ws if w[4] == 'SIRET'][0]
        yc = (sx[1] + sx[3]) / 2
        r = pg.runs(yc, sx[2] + 1)
        page['siret'] = [[round((r[i] + r[i + 1]) / 2, 1), round(H - yc - 2.6, 1)] for i in range(min(14, len(r) - 1))]
        du = [w for w in ws if w[4] == 'mois'][0]
        r = pg.runs((du[1] + du[3]) / 2, du[2] + 1)
        page['duree'] = [[round((r[i] + r[i + 1]) / 2, 1), round(H - (du[1] + du[3]) / 2 - 2.6, 1)] for i in range(2)]
        ad = [w for w in ws if w[4] == 'Adresse' and w[0] < 40][0]
        page['address'] = [round([w for w in ws if w[4] == 'Désignation'][0][2] + 70, 1), round(H - (ad[1] + ad[3]) / 2 - 2.6, 1)]
    # date de clôture (cases JJ MM AAAA sous « Exercice N clos le »)
    clos = [w for w in ws if w[4] == 'clos']
    if key in 'AB' and clos:
        c = clos[0]
        # lignes (au quart de point) où l'on croise les 8 cases : on retient le milieu de la bande
        hits = []
        for q in range(8, 72):
            yc = c[3] + q / 4
            r = pg.runs(yc, c[0] - 70, 575)
            def framed(a, b):
                # une case a un filet au-dessus et au-dessous ; l'espace entre deux groupes de cases n'en a pas
                x, y = int((a + b) / 2 * K), int(yc * K)
                up = any(pg.px[x, y - k] < 150 for k in range(2, int(6 * K)))
                down = any(pg.px[x, y + k] < 150 for k in range(2, int(6 * K)))
                return up and down
            cells = [(r[i], r[i + 1]) for i in range(len(r) - 1) if 4 < r[i + 1] - r[i] < 14 and framed(r[i], r[i + 1])]
            if len(cells) >= 8: hits.append((yc, cells[:8]))
        if hits:
            yc, cells = hits[len(hits) // 2]
            page['closDate'] = [[round((a + b) / 2, 1), round(H - yc - 2.0, 1)] for a, b in cells]
    layout['2033'][key] = page

# ------------------------------------------------------------------ 2031 : page 1
pg = Page('r2031-1.png')
ws = words('bbox2031.html', 0)
def w(text, n=0, ymin=0):
    m = [x for x in ws if x[4] == text and x[1] >= ymin]
    return m[n]
def after(text, n=0, ymin=0, skip=0):
    x0, y0, x1, y1, _ = w(text, n, ymin)
    yc = (y0 + y1) / 2
    c = cell_after(pg, x1, yc, skip)
    return slot(c[0], c[1], yc)
f = {}
f['ouvert'] = after('le', 0)                    # Exercice ouvert le
f['clos'] = after('le', 1)                      # et clos le
x0, y0, x1, y1, _ = [x for x in ws if x[4].startswith('d’imposition') or x[4].startswith("d'imposition")][0]
f['simplifie'] = slot(*cell_after(pg, x1, (y0 + y1) / 2), (y0 + y1) / 2)
x0, y0, x1, y1, _ = [x for x in ws if x[4] == ':' and 160 < x[1] < 175][0]
f['denomination'] = [round(x1 + 4, 1), round(H - (y0 + y1) / 2 - 2.6, 1)]
ad = [x for x in ws if x[4] == ':' and 175 < x[1] < 190][0]
f['adresse'] = [round(ad[2] + 4, 1), round(H - (ad[1] + ad[3]) / 2 - 2.6, 1)]
sx = w('SIREN')
yc = (sx[1] + sx[3]) / 2
r = pg.runs(yc, sx[2] + 1, 300)
f['siren'] = [[round((r[i] + r[i + 1]) / 2, 1), round(H - yc - 2.6, 1)] for i in range(len(r) - 1)]
f['domicile'] = [305.0, round(H - 192 - 2.6, 1)]
ac = [x for x in ws if x[4] == ':' and 230 < x[1] < 242][0]
f['activite'] = [round(ac[2] + 4, 1), round(H - (ac[1] + ac[3]) / 2 - 2.6, 1)]
cols = pg.runs(271, 380)
for name, label, n in [('r1', '1.', 0), ('r3', '3.', 0), ('r4', '4.', 0)]:
    x0, y0, x1, y1, _ = [x for x in ws if x[4] == label and x[0] < 30][n]
    yc = (y0 + y1) / 2
    r = [c for c in pg.runs(yc, 380)]
    f[name] = [slot(r[0], r[1], yc), slot(r[1], r[2], yc)]
f['bicA'] = after('BÉNÉFICE')
f['bicB'] = after('DÉFICIT', 0, 570)
f['non'] = after('NON', 0, 700)
layout['2031'] = f

ts = '/**\n * Position des cases des imprimés officiels (millésime 2026) : 2031-SD (n° 11085*28) page 1, 2033-SD (A à G).\n' \
     ' * Généré par scripts/cerfa_layout.py à partir des PDF de impots.gouv.fr ; ne pas modifier à la main.\n' \
     ' * Case : [x gauche, x droite, ligne de base] en points PDF (origine en bas à gauche).\n */\n' \
     f'export const CERFA_LAYOUT = {json.dumps(layout, ensure_ascii=False)} as const;\n'
open(sys.argv[2], 'w').write(ts)
print({k: len(v['boxes']) for k, v in layout['2033'].items()}, list(layout['2031'].keys()))
