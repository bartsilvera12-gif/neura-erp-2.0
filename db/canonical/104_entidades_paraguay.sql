-- =============================================================================
-- CATÁLOGO DE ENTIDADES DE PARAGUAY (pedido del dueño, 30-oct-2026).
--
-- Todo lo que puede tener una cuenta para transferir: bancos, financieras, billeteras electrónicas
-- y cooperativas. Fuentes:
--   · Bancos: registro de entidades de la Superintendencia de Bancos (espejo banco.com.py, may-2026),
--     corregido con la prensa: Río absorbido por Continental (ago-2025), Visión absorbido por Ueno
--     (2024); Atlas y Familiar siguen separados (la fusión no se concretó).
--   · Financieras: listado de entidades supervisadas del BCP (dic-2024).
--   · Billeteras: ABC Color (mar-2026). Sin listado oficial a mano.
--   · Cooperativas: informe del INCOOP de ahorro y crédito tipo A (mar-2025). Las más chicas no
--     están: se agregan en Conciliación › Bancos o se usa "Otra cooperativa".
-- Cada empresa puede editar su catálogo: esto no pisa nombres agregados, ni "sin referencia", ni lo
-- que se haya desactivado. Río y Visión se desactivan sin borrarlos: tienen historia.
--
-- IDEMPOTENTE. Va después de 103.
-- =============================================================================

begin;
set local search_path to :"schema", public;

-- La fila genérica "Cooperativa" pasa a ser la opción de "otra" (conserva su id).
update :"schema".bancos b set nombre = 'Otra cooperativa'
 where lower(b.nombre) = 'cooperativa'
   and not exists (select 1 from :"schema".bancos x where x.empresa_id = b.empresa_id and lower(x.nombre) = 'otra cooperativa');

update :"schema".bancos set activo = false where lower(nombre) in ('visión', 'vision', 'río', 'rio') and activo;

insert into :"schema".bancos (empresa_id, nombre, orden)
select e.id, x.nombre, x.orden
  from :"schema".empresas e
 cross join (
   -- Bancos: del más grande al más chico (1–16)
   select * from (values
     ('Continental', 1), ('Itaú', 2), ('Sudameris', 3), ('GNB', 4), ('BNF', 5), ('Atlas', 6), ('Familiar', 7), ('Ueno', 8),
     ('Basa', 9), ('Bancop', 10), ('Interfisa', 11), ('Solar', 12), ('Zeta', 13), ('Citibank', 14), ('Banco do Brasil', 15),
     ('Banco de la Nación Argentina', 16),
     -- Financieras (100…). Lo agregado a mano queda en 50: después de los bancos.
     ('Financiera FIC', 100), ('Financiera Paraguayo Japonesa', 101), ('Finlatina', 102), ('Tu Financiera', 103),
     -- Billeteras (200…)
     ('Tigo Money', 200), ('Personal Pay', 201), ('Claro', 202), ('Zimple', 203), ('Wally', 204), ('Eko', 205), ('Mango', 206),
     -- Al final
     ('Otra cooperativa', 980), ('Otro', 999)
   ) a(nombre, orden)
   union all
   -- Cooperativas (300…), en orden alfabético
   select 'Cooperativa ' || c.n, 299 + row_number() over (order by c.n)::integer
     from unnest(array[
       '5 de Febrero', '8 de Marzo', '21 de Setiembre', '24 de Octubre', 'Alemán Concordia', 'Ayacapé', 'CACEC', 'Capiatá', 'Cofan',
       'Coodeñe', 'Coofy', 'Coomecipar', 'Coopafiol', 'Coopasi (San Ignacio)', 'Coopec', 'Coopeduc', 'Coopediez', 'Coopejas', 'Coopensa',
       'Coopersam', 'Coopersanjuba', 'Coosofan', 'Copacons', 'Copafi Areguá', 'Credit Unión', 'Credivill', 'Cumbre de la Cordillera',
       'Del Sur', 'El Buen Camino', 'Exa San José', 'Farmcredit', 'Itacurubí', 'Judicial', 'Ka''aru Pora', 'La Barrereña', 'Lambaré',
       'Loma Plata', 'Luque', 'Mborayhu', 'Mburicaó', 'Medalla Milagrosa', 'Mercado Nº 4', 'Nazareth', 'Ñandutí', 'Ñemby', 'Poravo Ty',
       'Reducto', 'Sagrados Corazones', 'San Cristóbal', 'San Lorenzo', 'Serrana', 'Tobatí', 'Universitaria', 'Ycuá Bolaños', 'Yoayu', 'Ypacaraí'
     ]) as c(n)
 ) x
on conflict (empresa_id, lower(nombre)) do update set orden = excluded.orden;

commit;
