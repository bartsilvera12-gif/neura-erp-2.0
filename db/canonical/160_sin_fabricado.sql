-- =============================================================================
-- Se va el tipo "Fabricado" (pedido del dueño, 5-nov-2026): lo que era Fabricado pasa a Menú
-- (sin stock propio, descuenta su receta al venderse). Va después de 97.
--
--   · Las producciones confirmadas de cada fabricado se anulan con anular_produccion (lo
--     fabricado sale del stock y las materias primas vuelven, con su costo y lote), como lo
--     haría un administrador de esa empresa.
--   · Si después le queda stock (ya se vendió o trasladó parte) o es ingrediente de otra
--     receta, la receta frena y dice cuál: hay que resolverlo a mano.
--   · El tipo deja de existir: productos_tipo_producto_check ya no acepta 'fabricado'.
--   · Fabricar por tanda sigue para las preparaciones (materia prima con receta "por tanda").
--
-- IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public, extensions;

do $do$
declare
  p record;
  a record;
  v_admin uuid;
  v_usos integer;
begin
  for p in select * from productos where tipo_producto = 'fabricado' loop
    for a in select id, numero from producciones
              where producto_id = p.id and estado = 'confirmada' order by created_at desc loop
      select u.auth_user_id into v_admin
        from usuarios u
       where u.empresa_id = p.empresa_id and u.activo and upper(u.rol) = 'ADMIN' and u.auth_user_id is not null
       order by u.creado_at limit 1;
      if v_admin is null then
        raise exception '"%" tiene la producción % y su empresa no tiene un administrador activo para anularla', p.nombre, a.numero;
      end if;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_admin::text, true);
      perform anular_produccion(a.id, 'El tipo Fabricado pasa a Menú');
    end loop;

    select (select count(*) from recetas_items where insumo_id = p.id)
         + (select count(*) from plato_opcion_items where insumo_id = p.id) into v_usos;
    if v_usos > 0 then
      raise exception '"%" es ingrediente de % receta(s) u opciones: un Menú no puede ser ingrediente, resolvelo a mano', p.nombre, v_usos;
    end if;
    if coalesce((select stock_actual from productos where id = p.id), 0) <> 0 then
      raise exception '"%" todavía tiene stock después de anular sus producciones: dejalo en 0 con un ajuste y volvé a correr la receta', p.nombre;
    end if;

    update productos set tipo_producto = 'menu', updated_at = now() where id = p.id;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$do$;

alter table :"schema".productos drop constraint if exists productos_tipo_producto_check;
alter table :"schema".productos add constraint productos_tipo_producto_check
  check (tipo_producto in ('reventa', 'menu', 'materia_prima'));
comment on column :"schema".productos.tipo_producto is
  'reventa (stock propio) · menu (sin stock: descuenta su receta al venderse) · materia_prima (se compra, no se vende; con receta = preparación, que puede fabricarse por tanda). Recetas 72, 97 y 160 (sin Fabricado).';

commit;
