/* COPIA AUTOMÁTICA de asistente.json: no la edite a mano (se regenera con INICIAR_PHYLLOBYTES.py o SINCRONIZAR_DATOS.py). */
window.PHY_ASISTENTE_JSON = {
 "_leeme": "Archivo del asistente. Edite aquí las preguntas (opciones) y respuestas; no hay cuadro de texto. Ver web/data/ASISTENTE_LEEME.md. Todo texto puede ser una cadena, una lista de líneas, o {\"es\": ..., \"en\": ...}.",
 "version": 1,
 "inicio": "inicio",
 "textos": {
  "titulo": {
   "es": "Asistente de Phyllobytes",
   "en": "Phyllobytes assistant"
  },
  "subtitulo": {
   "es": "Elige una opción para ver la respuesta",
   "en": "Pick an option to see the answer"
  },
  "menu": {
   "es": "↺ Menú principal",
   "en": "↺ Main menu"
  },
  "elige": {
   "es": "Elige una opción:",
   "en": "Pick an option:"
  }
 },
 "nodos": {
  "inicio": {
   "mensaje": {
    "es": [
     "¡Hola! Soy el asistente de Phyllobytes.",
     "Elige un tema y te explico, paso a paso."
    ],
    "en": [
     "Hi! I'm the Phyllobytes assistant.",
     "Pick a topic and I'll explain it step by step."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué es Phyllobytes?",
      "en": "What is Phyllobytes?"
     },
     "ir": "que_es"
    },
    {
     "texto": {
      "es": "¿De dónde salen los datos?",
      "en": "Where does the data come from?"
     },
     "ir": "datos"
    },
    {
     "texto": {
      "es": "¿Cómo uso el mapa?",
      "en": "How do I use the map?"
     },
     "ir": "uso_mapa"
    },
    {
     "texto": {
      "es": "¿Cómo leo los resultados?",
      "en": "How do I read the results?"
     },
     "ir": "resultados"
    },
    {
     "texto": {
      "es": "Mis puntos ahora",
      "en": "My points right now"
     },
     "ir": "mis_puntos"
    },
    {
     "texto": {
      "es": "Lo que no se puede concluir",
      "en": "What can't be concluded"
     },
     "ir": "limites"
    },
    {
     "texto": {
      "es": "Accesibilidad e idioma",
      "en": "Accessibility and language"
     },
     "ir": "acceso"
    }
   ]
  },
  "que_es": {
   "mensaje": {
    "es": [
     "Phyllobytes es un atlas de lluvia de Costa Rica. Usa datos de satélites de NASA para contar cuántos días de lluvia fuerte hubo cada año en los puntos que elijas y si esa cifra sube, baja o se mantiene. La rana del logo es una guía amigable para explorar el país."
    ],
    "en": [
     "Phyllobytes is a rainfall atlas of Costa Rica. It uses NASA satellite data to count how many heavy-rain days there were each year at the points you choose, and whether that number rises, falls or stays the same. The frog in the logo is a friendly guide for exploring the country."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Para quién sirve?",
      "en": "Who is it for?"
     },
     "ir": "usuarios"
    },
    {
     "texto": {
      "es": "¿De dónde salen los datos?",
      "en": "Where does the data come from?"
     },
     "ir": "datos"
    },
    {
     "texto": {
      "es": "Ir al mapa",
      "en": "Go to the map"
     },
     "accion": "ir_seccion",
     "valor": "mapa-seccion"
    }
   ]
  },
  "usuarios": {
   "mensaje": {
    "es": [
     "Sirve a estudiantes, docentes, comunidades, equipos de gestión del agua y del riesgo, agricultura y cualquier persona curiosa. Ayuda a entender cómo cambia la lluvia y a decidir dónde conviene profundizar con estudios locales."
    ],
    "en": [
     "It serves students, teachers, communities, water and risk management teams, agriculture and anyone curious. It helps understand how rainfall changes and decide where to dig deeper with local studies."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué es Phyllobytes?",
      "en": "What is Phyllobytes?"
     },
     "ir": "que_es"
    },
    {
     "texto": {
      "es": "¿Qué no puede concluirse?",
      "en": "What can't be concluded?"
     },
     "ir": "limites"
    }
   ]
  },
  "datos": {
   "mensaje": {
    "es": [
     "Los datos vienen de satélites de NASA. El producto GPM IMERG estima la lluvia desde el espacio y el servicio NASA POWER la entrega día por día para cualquier coordenada. Phyllobytes (el servidor de Python) la descarga, revisa que no falten días, cuenta los días de lluvia fuerte de cada año y calcula la tendencia. Todo se guarda en archivos TXT y CSV que puedes descargar."
    ],
    "en": [
     "The data comes from NASA satellites. The GPM IMERG product estimates rainfall from space and the NASA POWER service delivers it day by day for any coordinate. Phyllobytes (the Python server) downloads it, checks that no days are missing, counts each year's heavy-rain days and calculates the trend. Everything is saved in TXT and CSV files you can download."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Los datos son reales?",
      "en": "Is the data real?"
     },
     "ir": "demo"
    },
    {
     "texto": {
      "es": "¿Qué tan detallado es?",
      "en": "How detailed is it?"
     },
     "ir": "resolucion"
    },
    {
     "texto": {
      "es": "¿Qué años se usan?",
      "en": "Which years are used?"
     },
     "ir": "periodo"
    },
    {
     "texto": {
      "es": "¿Cómo analizo con datos reales?",
      "en": "How do I analyze real data?"
     },
     "ir": "analizar"
    }
   ]
  },
  "demo": {
   "mensaje": {
    "es": "{{estado_demo}}",
    "en": "{{estado_demo}}"
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Cómo analizo con datos reales?",
      "en": "How do I analyze real data?"
     },
     "ir": "analizar"
    },
    {
     "texto": {
      "es": "¿De dónde salen los datos?",
      "en": "Where does the data come from?"
     },
     "ir": "datos"
    }
   ]
  },
  "resolucion": {
   "mensaje": {
    "es": [
     "IMERG tiene una resolución de unos 0,1° (~10 km). Cada punto representa la celda satelital que lo contiene, es decir, el entorno de la zona. No describe un barrio, una finca ni una calle. Los límites de las provincias del mapa son aproximados."
    ],
    "en": [
     "IMERG has a resolution of about 0.1° (~10 km). Each point represents the satellite cell that contains it, i.e. the surrounding area. It does not describe a neighbourhood, a farm or a street. The province borders on the map are approximate."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿De dónde salen los datos?",
      "en": "Where does the data come from?"
     },
     "ir": "datos"
    },
    {
     "texto": {
      "es": "¿Qué no puede concluirse?",
      "en": "What can't be concluded?"
     },
     "ir": "limites"
    }
   ]
  },
  "periodo": {
   "mensaje": {
    "es": [
     "Se usa el periodo que elijas en «Opciones del análisis» (por defecto 2001–2025). El umbral de «lluvia fuerte» se calcula con los primeros 20 años (la franja sombreada de la gráfica) y luego se cuentan los días que lo superan en cada año. Solo se usan años completos."
    ],
    "en": [
     "The period is whatever you choose under “Analysis options” (default 2001–2025). The “heavy rain” threshold is computed with the first 20 years (the shaded band on the chart) and then the days exceeding it are counted each year. Only complete years are used."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿De dónde salen los datos?",
      "en": "Where does the data come from?"
     },
     "ir": "datos"
    },
    {
     "texto": {
      "es": "¿Qué es un día de lluvia fuerte?",
      "en": "What is a heavy-rain day?"
     },
     "ir": "extremo"
    }
   ]
  },
  "analizar": {
   "mensaje": {
    "es": "{{estado_analisis}}",
    "en": "{{estado_analisis}}"
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Los datos son reales?",
      "en": "Is the data real?"
     },
     "ir": "demo"
    },
    {
     "texto": {
      "es": "Copiar la ficha de evidencia",
      "en": "Copy the evidence sheet"
     },
     "ir": "ficha"
    }
   ]
  },
  "uso_mapa": {
   "mensaje": {
    "es": [
     "Con el menú de la izquierda o las pastillas de arriba puedes ir a cada parte: Mapa, Resultados, Comparar, Aprende y Método. Toca un punto del mapa para ver sus gráficas. En «Aprende» hay una explicación desde cero.",
     "",
     "Toca cualquier lugar dentro de Costa Rica en el mapa y se añade un punto (hasta 8). También puedes buscar un lugar por nombre o escribir coordenadas en «Mis puntos». Para quitar uno pulsa la ✕. Luego pulsa «Analizar con datos NASA»."
    ],
    "en": [
     "With the menu on the left or the pills at the top you can go to each part: Map, Results, Compare, Learn and Method. Tap a point on the map to see its charts. “Learn” has an explanation from scratch.",
     "",
     "Tap anywhere inside Costa Rica on the map and a point is added (up to 8). You can also search a place by name or type coordinates under “My points”. To remove one press the ✕. Then press “Analyse with NASA data”."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué es el mapa de calor?",
      "en": "What is the heat map?"
     },
     "ir": "calor"
    },
    {
     "texto": {
      "es": "¿Cómo analizo con datos reales?",
      "en": "How do I analyze real data?"
     },
     "ir": "analizar"
    },
    {
     "texto": {
      "es": "Ir al mapa",
      "en": "Go to the map"
     },
     "accion": "ir_seccion",
     "valor": "mapa-seccion"
    }
   ]
  },
  "calor": {
   "mensaje": {
    "es": [
     "El mapa de calor colorea el país según el indicador que elijas. Los colores van de oscuros (valores bajos) a claros (altos) y las líneas separan niveles, como curvas de nivel. Entre puntos es una estimación suavizada, así que más puntos dan un mapa más fiel. Puedes cambiar el estilo (Curvas, Suave o Sin color)."
    ],
    "en": [
     "The heat map colours the country by the indicator you choose. Colours go from dark (low values) to light (high) and the lines separate levels, like contour lines. Between points it is a smoothed estimate, so more points make a more faithful map. You can change the style (Contours, Smooth or No colour)."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Cómo agrego un punto?",
      "en": "How do I add a point?"
     },
     "ir": "uso_mapa"
    },
    {
     "texto": {
      "es": "¿Hay colores para daltonismo?",
      "en": "Are there colourblind-friendly colours?"
     },
     "ir": "acceso"
    }
   ]
  },
  "ficha": {
   "mensaje": {
    "es": [
     "En los resultados de cada punto hay un botón «Copiar ficha de evidencia». Copia un texto con el resultado, el rango, el valor p, el umbral y la fuente. También puedes descargar sus datos en CSV."
    ],
    "en": [
     "Each point's results have a “Copy evidence sheet” button. It copies a text with the result, range, p-value, threshold and source. You can also download its data as CSV."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "Cómo leo los resultados",
      "en": "How do I read the results"
     },
     "ir": "resultados"
    }
   ]
  },
  "resultados": {
   "mensaje": {
    "es": [
     "¿Qué parte de los resultados quieres entender?"
    ],
    "en": [
     "Which part of the results do you want to understand?"
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué es un día de lluvia fuerte?",
      "en": "What is a heavy-rain day?"
     },
     "ir": "extremo"
    },
    {
     "texto": {
      "es": "¿Cómo leo las gráficas?",
      "en": "How do I read the charts?"
     },
     "ir": "grafico"
    },
    {
     "texto": {
      "es": "¿Qué es Theil–Sen?",
      "en": "What is Theil–Sen?"
     },
     "ir": "theil"
    },
    {
     "texto": {
      "es": "¿Qué es Mann–Kendall?",
      "en": "What is Mann–Kendall?"
     },
     "ir": "mann"
    },
    {
     "texto": {
      "es": "¿Qué es el intervalo de confianza?",
      "en": "What is a confidence interval?"
     },
     "ir": "ic"
    },
    {
     "texto": {
      "es": "¿Qué es el valor p?",
      "en": "What is the p-value?"
     },
     "ir": "valor_p"
    },
    {
     "texto": {
      "es": "¿Qué es el ajuste de Holm?",
      "en": "What is the Holm adjustment?"
     },
     "ir": "holm"
    },
    {
     "texto": {
      "es": "¿Qué significa no concluyente?",
      "en": "What does inconclusive mean?"
     },
     "ir": "nc"
    }
   ]
  },
  "extremo": {
   "mensaje": {
    "es": [
     "Un día lluvioso es uno con al menos 1 mm. Para cada punto se calcula el percentil 95 de sus días lluviosos: el límite del 5 % más intenso. Un «día de lluvia fuerte» es el que lo supera. Cada punto usa su propio límite, así que se compara la frecuencia, no los milímetros entre lugares."
    ],
    "en": [
     "A rainy day is one with at least 1 mm. For each point we compute the 95th percentile of its rainy days: the limit of the most intense 5%. A “heavy-rain day” is one that exceeds it. Each point uses its own limit, so frequency is compared, not millimetres between places."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Cómo leo las gráficas?",
      "en": "How do I read the charts?"
     },
     "ir": "grafico"
    },
    {
     "texto": {
      "es": "¿Qué es Theil–Sen?",
      "en": "What is Theil–Sen?"
     },
     "ir": "theil"
    }
   ]
  },
  "grafico": {
   "mensaje": {
    "es": [
     "Cada barra es un año: cuántos días superaron el umbral de lluvia fuerte. La línea naranja es la tendencia. La franja sombreada marca el periodo con el que se definió el umbral. Pasa el cursor o el dedo por la gráfica para ver cada año. Si la línea sube pero el punto sale «no concluyente», la diferencia puede ser variación natural."
    ],
    "en": [
     "Each bar is a year: how many days exceeded the heavy-rain threshold. The orange line is the trend. The shaded band marks the period used to define the threshold. Hover or drag a finger over the chart to see each year. If the line rises but the point says “inconclusive”, the difference may be natural variation."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué es Theil–Sen?",
      "en": "What is Theil–Sen?"
     },
     "ir": "theil"
    },
    {
     "texto": {
      "es": "¿Qué significa no concluyente?",
      "en": "What does inconclusive mean?"
     },
     "ir": "nc"
    },
    {
     "texto": {
      "es": "Ir a los resultados",
      "en": "Go to the results"
     },
     "accion": "ir_seccion",
     "valor": "resultados"
    }
   ]
  },
  "theil": {
   "mensaje": {
    "es": [
     "La pendiente de Theil–Sen estima cuántos días de lluvia fuerte más (o menos) hay por año, expresado por década. Usa la mediana de las pendientes entre todos los pares de años, así que un año muy raro la afecta poco. Es la línea naranja de la gráfica."
    ],
    "en": [
     "The Theil–Sen slope estimates how many more (or fewer) heavy-rain days there are per year, expressed per decade. It uses the median of the slopes between all pairs of years, so one very unusual year affects it little. It is the orange line on the chart."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué es Mann–Kendall?",
      "en": "What is Mann–Kendall?"
     },
     "ir": "mann"
    },
    {
     "texto": {
      "es": "¿Qué es el intervalo de confianza?",
      "en": "What is a confidence interval?"
     },
     "ir": "ic"
    }
   ]
  },
  "mann": {
   "mensaje": {
    "es": [
     "Mann–Kendall es una prueba estadística que revisa si una serie tiende a subir o bajar con el tiempo. Su resultado es un valor p: cuanto más pequeño, menos probable es que la tendencia sea casualidad."
    ],
    "en": [
     "Mann–Kendall is a statistical test that checks whether a series tends to rise or fall over time. Its result is a p-value: the smaller it is, the less likely the trend is chance."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué es el valor p?",
      "en": "What is the p-value?"
     },
     "ir": "valor_p"
    },
    {
     "texto": {
      "es": "¿Qué es el ajuste de Holm?",
      "en": "What is the Holm adjustment?"
     },
     "ir": "holm"
    }
   ]
  },
  "valor_p": {
   "mensaje": {
    "es": [
     "El valor p dice qué tan compatible es la serie con que no haya tendencia real. Si el p ajustado es menor que 0,05, se considera que hay evidencia de tendencia. Muestra que existe, no qué tan grande es: para eso mira el cambio y su rango."
    ],
    "en": [
     "The p-value tells how compatible the series is with there being no real trend. If the adjusted p is below 0.05, there is considered to be evidence of a trend. It shows that a trend exists, not how large it is: for that, look at the change and its range."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué es el ajuste de Holm?",
      "en": "What is the Holm adjustment?"
     },
     "ir": "holm"
    },
    {
     "texto": {
      "es": "¿Qué significa no concluyente?",
      "en": "What does inconclusive mean?"
     },
     "ir": "nc"
    }
   ]
  },
  "holm": {
   "mensaje": {
    "es": [
     "Al evaluar varios puntos a la vez aumenta la posibilidad de «encontrar» una tendencia solo por suerte. El ajuste de Holm corrige los valores p para compensarlo. Por eso se muestra el valor p ajustado; se marca evidencia cuando es menor que 0,05."
    ],
    "en": [
     "Testing several points at once raises the chance of “finding” a trend by luck alone. The Holm adjustment corrects the p-values to compensate. That is why the adjusted p-value is shown; evidence is flagged when it is below 0.05."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué es el valor p?",
      "en": "What is the p-value?"
     },
     "ir": "valor_p"
    },
    {
     "texto": {
      "es": "¿Qué significa no concluyente?",
      "en": "What does inconclusive mean?"
     },
     "ir": "nc"
    }
   ]
  },
  "ic": {
   "mensaje": {
    "es": [
     "El rango probable (intervalo de confianza al 95 %) es el conjunto de cambios razonables con estos datos. Si incluye el 0, no se puede descartar que no haya cambio. Cuanto más ancho, más incertidumbre."
    ],
    "en": [
     "The likely range (95% confidence interval) is the set of changes that are reasonable given this data. If it includes 0, a no-change result cannot be ruled out. The wider it is, the more uncertainty."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué significa no concluyente?",
      "en": "What does inconclusive mean?"
     },
     "ir": "nc"
    },
    {
     "texto": {
      "es": "¿Qué es Theil–Sen?",
      "en": "What is Theil–Sen?"
     },
     "ir": "theil"
    }
   ]
  },
  "nc": {
   "mensaje": {
    "es": [
     "«No concluyente» significa que, con estos datos, no se puede distinguir un cambio de la variación natural de un año a otro. No equivale a «no cambió»: solo que no hay evidencia suficiente para afirmar que sube ni que baja."
    ],
    "en": [
     "“Inconclusive” means that, with this data, a change cannot be told apart from natural year-to-year variation. It does not mean “nothing changed”: only that there is not enough evidence to say it rises or falls."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué es el intervalo de confianza?",
      "en": "What is a confidence interval?"
     },
     "ir": "ic"
    },
    {
     "texto": {
      "es": "¿Qué no puede concluirse?",
      "en": "What can't be concluded?"
     },
     "ir": "limites"
    }
   ]
  },
  "mis_puntos": {
   "mensaje": {
    "es": [
     "Esto es lo que hay en tu mapa ahora mismo:",
     "",
     "{{resumen_regional}}"
    ],
    "en": [
     "This is what is on your map right now:",
     "",
     "{{resumen_regional}}"
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Dónde aumentó más?",
      "en": "Where did it increase most?"
     },
     "ir": "mayor_aumento"
    },
    {
     "texto": {
      "es": "¿Dónde disminuyó?",
      "en": "Where did it decrease?"
     },
     "ir": "mayor_disminucion"
    },
    {
     "texto": {
      "es": "Interpretar el punto seleccionado",
      "en": "Interpret the selected point"
     },
     "ir": "punto_actual"
    },
    {
     "texto": {
      "es": "Ver la lista de mis puntos",
      "en": "See my list of points"
     },
     "ir": "lista_puntos"
    }
   ]
  },
  "mayor_aumento": {
   "mensaje": {
    "es": "{{mayor_aumento}}",
    "en": "{{mayor_aumento}}"
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Dónde disminuyó?",
      "en": "Where did it decrease?"
     },
     "ir": "mayor_disminucion"
    },
    {
     "texto": {
      "es": "Interpretar el punto seleccionado",
      "en": "Interpret the selected point"
     },
     "ir": "punto_actual"
    },
    {
     "texto": {
      "es": "¿Qué significa no concluyente?",
      "en": "What does inconclusive mean?"
     },
     "ir": "nc"
    }
   ]
  },
  "mayor_disminucion": {
   "mensaje": {
    "es": "{{mayor_disminucion}}",
    "en": "{{mayor_disminucion}}"
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Dónde aumentó más?",
      "en": "Where did it increase most?"
     },
     "ir": "mayor_aumento"
    },
    {
     "texto": {
      "es": "Interpretar el punto seleccionado",
      "en": "Interpret the selected point"
     },
     "ir": "punto_actual"
    },
    {
     "texto": {
      "es": "¿Qué significa no concluyente?",
      "en": "What does inconclusive mean?"
     },
     "ir": "nc"
    }
   ]
  },
  "punto_actual": {
   "mensaje": {
    "es": "{{lectura_punto}}",
    "en": "{{lectura_punto}}"
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Cómo leo las gráficas?",
      "en": "How do I read the charts?"
     },
     "ir": "grafico"
    },
    {
     "texto": {
      "es": "¿Qué significa no concluyente?",
      "en": "What does inconclusive mean?"
     },
     "ir": "nc"
    },
    {
     "texto": {
      "es": "Ir a los resultados",
      "en": "Go to the results"
     },
     "accion": "ir_seccion",
     "valor": "resultados"
    }
   ]
  },
  "lista_puntos": {
   "mensaje": {
    "es": "{{lista_puntos}}",
    "en": "{{lista_puntos}}"
   },
   "opciones": [
    {
     "texto": {
      "es": "Resumen de todos los puntos",
      "en": "Summary of all points"
     },
     "ir": "mis_puntos"
    }
   ]
  },
  "limites": {
   "mensaje": {
    "es": [
     "Con Phyllobytes no se puede:",
     "• Pronosticar lluvia ni dar alertas.",
     "• Estudiar un barrio, una finca o un cauce (la escala es ~10 km).",
     "• Afirmar que una tendencia se debe al cambio climático.",
     "• Concluir que la lluvia cambia en todo el país.",
     "Sí sirve para aprender y para decidir dónde conviene estudiar más."
    ],
    "en": [
     "With Phyllobytes you cannot:",
     "• Forecast rain or issue alerts.",
     "• Study a neighbourhood, a farm or a river channel (the scale is ~10 km).",
     "• Claim a trend is due to climate change.",
     "• Conclude that rainfall is changing across the whole country.",
     "It is useful for learning and for deciding where to study more."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Es un pronóstico o una alerta?",
      "en": "Is it a forecast or an alert?"
     },
     "ir": "pronostico"
    },
    {
     "texto": {
      "es": "¿Por qué está cambiando la lluvia?",
      "en": "Why is rainfall changing?"
     },
     "ir": "causas"
    },
    {
     "texto": {
      "es": "¿Qué significa no concluyente?",
      "en": "What does inconclusive mean?"
     },
     "ir": "nc"
    }
   ]
  },
  "pronostico": {
   "mensaje": {
    "es": [
     "No. Phyllobytes describe lo que ya pasó en datos históricos; no es un pronóstico, una alerta de inundaciones ni un estudio de riesgo. Para alertas, consulta al IMN y a la CNE."
    ],
    "en": [
     "No. Phyllobytes describes what already happened in historical data; it is not a forecast, a flood alert or a risk study. For alerts, check with IMN and CNE."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué no puede concluirse?",
      "en": "What can't be concluded?"
     },
     "ir": "limites"
    },
    {
     "texto": {
      "es": "¿Qué es un día de lluvia fuerte?",
      "en": "What is a heavy-rain day?"
     },
     "ir": "extremo"
    }
   ]
  },
  "causas": {
   "mensaje": {
    "es": [
     "Phyllobytes no identifica causas. Una tendencia en días de lluvia fuerte describe un cambio observado en la serie; atribuirlo al cambio climático o a otro factor requiere más evidencia que este proyecto no incluye."
    ],
    "en": [
     "Phyllobytes does not identify causes. A trend in heavy-rain days describes a change observed in the series; attributing it to climate change or any other factor needs more evidence than this project includes."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "¿Qué no puede concluirse?",
      "en": "What can't be concluded?"
     },
     "ir": "limites"
    },
    {
     "texto": {
      "es": "¿Qué es un día de lluvia fuerte?",
      "en": "What is a heavy-rain day?"
     },
     "ir": "extremo"
    }
   ]
  },
  "acceso": {
   "mensaje": {
    "es": [
     "Arriba a la derecha está el botón «Accesibilidad». Allí puedes activar contraste alto, hacer la letra más grande, usar colores aptos para daltonismo (azul y amarillo, con símbolos ▲ ▼ ●) y quitar animaciones. Se guarda para tu próxima visita.",
     "",
     "Con el botón ES / EN de arriba cambias toda la página entre español e inglés. También respondo en el idioma que tengas activo."
    ],
    "en": [
     "At the top right there is an “Accessibility” button. There you can turn on high contrast, make text larger, use colourblind-friendly colours (blue and yellow, with ▲ ▼ ● symbols) and turn off animations. It is remembered for your next visit.",
     "",
     "With the ES / EN button at the top you switch the whole page between Spanish and English. I also answer in whichever language is active."
    ]
   },
   "opciones": [
    {
     "texto": {
      "es": "Abrir accesibilidad",
      "en": "Open accessibility"
     },
     "accion": "abrir_accesibilidad"
    },
    {
     "texto": {
      "es": "¿Qué es el mapa de calor?",
      "en": "What is the heat map?"
     },
     "ir": "calor"
    }
   ]
  }
 }
};
