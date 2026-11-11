import numpy as np
import pandas as pd
import pymannkendall as pmk
import pytest

import trendkit as T


def test_mann_kendall_coincide_con_pymannkendall():
    rng = np.random.default_rng(1)
    y = np.arange(25) * 0.4 + rng.normal(0, 2, 25)
    _, p = T.mann_kendall(y)
    assert p == pytest.approx(pmk.original_test(y).p, rel=1e-6)


def test_mann_kendall_con_empates_coincide():
    y = np.array([3, 3, 4, 4, 5, 5, 5, 6, 7, 7, 8, 8, 9, 9, 9, 10], dtype=float)
    tau, p = T.mann_kendall(y)
    assert p == pytest.approx(pmk.original_test(y).p, rel=1e-6)
    assert tau > 0.9


def test_holm_a_mano():
    # p = [0.01, 0.04, 0.03] -> orden 0.01, 0.03, 0.04
    # ajustados: 3*0.01=0.03 ; max(0.03, 2*0.03=0.06)=0.06 ; max(0.06, 1*0.04)=0.06
    aj = T.holm([0.01, 0.04, 0.03])
    assert aj == pytest.approx([0.03, 0.06, 0.06])


def test_theil_sen_recupera_pendiente_conocida():
    x = np.arange(2000, 2025)
    y = 5 + 0.5 * (x - 2000)
    pend, lo, hi = T.theil_sen(x, y)
    assert pend == pytest.approx(0.5)
    assert lo <= pend <= hi


def test_serie_aleatoria_no_es_significativa():
    rng = np.random.default_rng(7)
    _, p = T.mann_kendall(rng.normal(0, 1, 25))
    assert p > 0.05


def test_umbral_usa_solo_el_periodo_base():
    idx = pd.date_range("2000-01-01", "2009-12-31", freq="D")
    base = pd.Series(10.0, index=idx)
    idx2 = pd.date_range("2010-01-01", "2012-12-31", freq="D")
    despues = pd.Series(500.0, index=idx2)          # no debe influir
    serie = pd.concat([base, despues])
    assert T.umbral_percentil(serie, (2000, 2009), 95) == pytest.approx(10.0)


def test_anio_incompleto_queda_como_nan():
    idx = pd.date_range("2001-01-01", "2002-12-31", freq="D")
    serie = pd.Series(20.0, index=idx)
    serie.loc["2001-01-01":"2001-07-31"] = np.nan   # ~58 % de faltantes
    c = T.conteo_anual(serie, 10.0, 2001, 2002, min_frac=0.8)
    assert np.isnan(c[2001])
    assert c[2002] == 365


def test_clasificar():
    assert T.clasificar(1.2, 0.01) == "creciente"
    assert T.clasificar(-1.2, 0.01) == "decreciente"
    assert T.clasificar(1.2, 0.2) == "no_concluyente"
    assert T.clasificar(1.2, float("nan")) == "no_concluyente"
