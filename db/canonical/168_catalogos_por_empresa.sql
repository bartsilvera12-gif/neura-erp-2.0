-- =============================================================================
-- Catálogos iniciales por empresa, también para las empresas NUEVAS.
--
-- Igual que la 161 (Soporte) y la 167 (etapas del CRM): estas recetas cargaban sus datos
-- "para cada empresa que exista", y en un clon corren ANTES de que seed-admin cree la
-- empresa. Todo cliente nuevo quedaba sin:
--   · 28  categorías de clientes (Minorista, Mayorista, Corporativo)
--   · 39  estados de proyectos (el tablero de Proyectos sin columnas)
--   · 43/104 bancos, financieras, billeteras y cooperativas (cobros y pagos sin entidades)
--   · 38  la cola "Atención general" del Omnicanal
--
-- No se cargan acá, a propósito:
--   · 36  el canal "WhatsApp (simulador)": es de prueba, un cliente real conecta el suyo.
--   · 97/99 numeracion_maximos: numeracion_asegurar crea el contador con el primer documento.
--
-- Una función que carga los catálogos de UNA empresa, un trigger al crear la empresa y un
-- relleno de las que ya existen. IDEMPOTENTE: no pisa lo que una empresa ya tenga o haya
-- editado (cada catálogo se carga solo si la empresa no tiene ninguno).
-- =============================================================================

begin;
set local search_path to :"schema", public;

create or replace function :"schema".catalogos_iniciales(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  -- 28: categorías de clientes
  if not exists (select 1 from cliente_categorias where empresa_id = p_empresa) then
    insert into cliente_categorias (empresa_id, nombre, color, orden)
    select p_empresa, c.* from (values ('Minorista', '#0d9488', 1), ('Mayorista', '#2563eb', 2), ('Corporativo', '#7c3aed', 3))
      as c(nombre, color, orden);
  end if;

  -- 39: estados de proyectos
  if not exists (select 1 from proyecto_estados where empresa_id = p_empresa) then
    insert into proyecto_estados (empresa_id, codigo, nombre, color, orden, tipo_sla, sla_horas_objetivo, rol, es_inicial, es_final)
    select p_empresa, x.* from (values
      ('nuevo', 'Nuevo', '#64748b', 1, 'interno', 8::numeric, 'nuevo', true, false),
      ('planificacion', 'Planificación', '#6366f1', 2, 'interno', 16::numeric, 'en_curso', false, false),
      ('en_curso', 'En curso', '#2563eb', 3, 'interno', null::numeric, 'en_curso', false, false),
      ('revision_interna', 'Revisión interna', '#0891b2', 4, 'interno', 8::numeric, 'revision', false, false),
      ('espera_cliente', 'Espera del cliente', '#f59e0b', 5, 'cliente', null::numeric, 'espera_cliente', false, false),
      ('pausado', 'Pausado', '#a855f7', 6, 'pausado', null::numeric, 'pausado', false, false),
      ('entregado', 'Entregado', '#16a34a', 7, 'final', null::numeric, 'entregado', false, true),
      ('cancelado', 'Cancelado', '#ef4444', 8, 'final', null::numeric, 'cancelado', false, true)
    ) as x(codigo, nombre, color, orden, tipo_sla, sla_horas_objetivo, rol, es_inicial, es_final);
  end if;

  -- 43 + 104: entidades de Paraguay, tal como quedan después de la 104
  -- (sin Visión ni Río, que la 104 desactiva; Familiar sin referencia y con prefijo FAM).
  if not exists (select 1 from bancos where empresa_id = p_empresa) then
    insert into bancos (empresa_id, nombre, orden)
    select p_empresa, x.nombre, x.orden from (
      select * from (values
        ('Continental', 1), ('Itaú', 2), ('Sudameris', 3), ('GNB', 4), ('BNF', 5), ('Atlas', 6), ('Familiar', 7), ('Ueno', 8),
        ('Basa', 9), ('Bancop', 10), ('Interfisa', 11), ('Solar', 12), ('Zeta', 13), ('Citibank', 14), ('Banco do Brasil', 15),
        ('Banco de la Nación Argentina', 16),
        ('Financiera FIC', 100), ('Financiera Paraguayo Japonesa', 101), ('Finlatina', 102), ('Tu Financiera', 103),
        ('Tigo Money', 200), ('Personal Pay', 201), ('Claro', 202), ('Zimple', 203), ('Wally', 204), ('Eko', 205), ('Mango', 206),
        ('Otra cooperativa', 980), ('Otro', 999)
      ) a(nombre, orden)
      union all
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
    on conflict (empresa_id, lower(nombre)) do nothing;
    update bancos set sin_referencia = true, prefijo = 'FAM' where empresa_id = p_empresa and nombre = 'Familiar';
  end if;

  -- 38: cola por defecto del Omnicanal, con los usuarios activos que ya tenga la empresa.
  if not exists (select 1 from chat_colas where empresa_id = p_empresa) then
    insert into chat_colas (empresa_id, nombre) values (p_empresa, 'Atención general');
    insert into chat_cola_agentes (cola_id, usuario_id, empresa_id)
    select q.id, u.id, q.empresa_id from chat_colas q join usuarios u on u.empresa_id = q.empresa_id and u.activo
     where q.empresa_id = p_empresa and q.nombre = 'Atención general'
    on conflict do nothing;
  end if;
end;
$fn$;

-- Empresas nuevas.
create or replace function :"schema".tg_empresas_catalogos()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  perform catalogos_iniciales(new.id);
  return null;
end;
$fn$;
drop trigger if exists trg_empresas_catalogos on :"schema".empresas;
create trigger trg_empresas_catalogos after insert on :"schema".empresas
  for each row execute function :"schema".tg_empresas_catalogos();

-- Empresas que ya existen (las clonadas antes de esta receta quedaron vacías).
do $mig$
declare e record;
begin
  for e in select id from empresas loop
    perform catalogos_iniciales(e.id);
  end loop;
end
$mig$;

revoke execute on function :"schema".catalogos_iniciales(uuid) from public, anon, authenticated;
revoke execute on function :"schema".tg_empresas_catalogos() from public, anon, authenticated;

commit;
