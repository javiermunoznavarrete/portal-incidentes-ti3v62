import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

fig, ax = plt.subplots(figsize=(13, 7.6), dpi=170)
ax.set_xlim(0, 130); ax.set_ylim(0, 76); ax.axis("off")
AZUL, AZUL_C, VERDE_C, GRIS, ROJO_C, TXT = "#1f4e79", "#e8eef6", "#e6f4ea", "#f4f5f7", "#fdecea", "#1c2430"

def zona(x, y, w, h, color, borde, titulo, estilo="-"):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1.5", fc=color, ec=borde, lw=1.6, ls=estilo))
    ax.text(x + 1.2, y + h - 1.6, titulo, fontsize=10.5, fontweight="bold", color=borde, va="top")

def caja(x, y, w, h, titulo, sub="", fc="white", ec=AZUL):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.3,rounding_size=1", fc=fc, ec=ec, lw=1.4))
    if not sub:
        ax.text(x + w / 2, y + h / 2, titulo, ha="center", va="center", fontsize=10, fontweight="bold", color=TXT)
        return
    ax.text(x + w / 2, y + h - 2.2, titulo, ha="center", va="center", fontsize=10, fontweight="bold", color=TXT)
    ax.text(x + w / 2, y + (h - 3.6) / 2, sub, ha="center", va="center", fontsize=7.8, color="#4a5565", linespacing=1.35)

def flecha(x1, y1, x2, y2, txt="", color=AZUL, estilo="-|>", ls="-", off=(0, 1.2)):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=estilo, mutation_scale=14, color=color, lw=1.5, ls=ls))
    if txt:
        ax.text((x1 + x2) / 2 + off[0], (y1 + y2) / 2 + off[1], txt, ha="center", fontsize=7.8, color=color,
                bbox=dict(fc="white", ec="none", pad=0.6))

# Internet
caja(2, 52, 16, 10, "Usuarios", "admin · analista · auditor", fc=GRIS, ec="#5b6676")
caja(2, 32, 16, 10, "Atacante", "fuerza bruta, CSRF,\nSQLi, escalada", fc=ROJO_C, ec="#b42318")
ax.text(10, 68, "INTERNET", ha="center", fontsize=11, fontweight="bold", color="#5b6676")

# Railway
zona(24, 4, 104, 68, "#fbfcfe", AZUL, "Railway — proyecto portal-incidentes-ti3v62 · entorno production · región asia-southeast1")
zona(27, 36, 30, 30, AZUL_C, AZUL, "Capa 1 · Borde (pública)")
caja(29.5, 41, 25, 18, "Edge proxy Railway", "TLS 1.2+/HTTPS\ndominio *.up.railway.app\nbalanceo entre réplicas\nprotección DDoS L3/L4")

zona(62, 36, 36, 30, VERDE_C, "#1d7a46", "Capa 2 · Aplicación (servicio portal-app)")
caja(64.5, 50, 14, 11, "Réplica 1", "Node 22 · usuario\nno root", ec="#1d7a46")
caja(81.5, 50, 14, 11, "Réplica 2", "Node 22 · usuario\nno root", ec="#1d7a46")
ax.text(80, 44.5, "RBAC · sesión HMAC · CSRF · CSP/HSTS\nbloqueo 5 intentos · rate limit · auditoría\nhealthcheck /health · restart ON_FAILURE", ha="center", va="center", fontsize=7.6, color="#1d4d2e")

zona(62, 7, 36, 24, ROJO_C, "#b42318", "Capa 3 · Datos (solo red privada)", estilo="--")
caja(66, 10, 28, 14, "PostgreSQL 18", "postgres.railway.internal:5432\nsin dominio ni proxy TCP público\nvolumen persistente · backups\nconsultas parametrizadas")

zona(102, 7, 24, 59, GRIS, "#5b6676", "Gestión y monitoreo")
caja(104, 49, 20, 12, "IAM Railway", "Owner (MFA)\nMember · Viewer\ntokens de proyecto", fc="white", ec="#5b6676")
caja(104, 31, 20, 12, "Variables / secretos", "SESSION_SECRET\nDATABASE_URL (ref.)\ncifradas en reposo", fc="white", ec="#5b6676")
caja(104, 12, 20, 13, "Observabilidad", "logs JSON (deploy/HTTP)\nmétricas CPU/RAM\ntabla auditoria", fc="white", ec="#5b6676")
caja(29.5, 9, 25, 14, "GitHub (privado)", "repo portal-incidentes\nCI → build Docker\nauto-deploy rama main", fc="white", ec="#5b6676")

flecha(18, 57, 29.5, 52, "HTTPS 443")
flecha(18, 37, 29.5, 46, "bloqueado: 401/403/423/429", color="#b42318", ls="--", off=(0, -3.2))
flecha(54.5, 52, 64.5, 55.5)
flecha(54.5, 48, 81.5, 52.5, off=(0, -2))
flecha(80, 41, 80, 24, "TCP 5432\nred privada", color="#1d7a46", off=(7, 0))
flecha(42, 23, 42, 41, "deploy", color="#5b6676", off=(4, 0))
flecha(98, 55, 104, 55, color="#5b6676", estilo="<|-|>")
flecha(98, 45, 104, 37, color="#5b6676")
flecha(98, 40, 104, 20, color="#5b6676")

plt.tight_layout()
plt.savefig("img/arquitectura.png", bbox_inches="tight", facecolor="white")
print("ok")
