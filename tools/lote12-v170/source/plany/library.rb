# encoding: UTF-8
require 'fileutils'
require 'securerandom'
require 'json'
require 'digest'

module RQMyDina
  module Library
    SavedSource = Struct.new(:path, :preview, :sha256)

    def self.deferred_source?(source)
      source.is_a?(SavedSource)
    end

    def self.validate_source_file!(source)
      return unless deferred_source?(source)
      unless File.file?(source.path) && Digest::SHA256.file(source.path).hexdigest == source.sha256
        raise IOError, 'O item salvo mudou durante a inserção. Abra a Biblioteca novamente.'
      end
    end

    def self.saved_source(path, preview)
      SavedSource.new(path.freeze, preview, Digest::SHA256.file(path).hexdigest.freeze).freeze
    end

    def self.validate_preview(preview)
      unless preview.is_a?(Array) && !preview.empty? && preview.all? do |piece|
        piece.is_a?(Hash) && %w[origin size].all? do |key|
          piece[key].is_a?(Array) && piece[key].length == 3 &&
            piece[key].all? { |v| v.is_a?(Numeric) && v.finite? && (key != 'size' || v > 0) }
        end
      end
        raise ArgumentError, 'Prévia do modelo salvo inválida.'
      end
      Dimensions.canonical(preview,'points')
    end

    def self.preview_from_definition(definition)
      pieces = []
      Graph.walk(definition.entities) do |path|
        next true unless Graph.registered?(path.last)
        bounds = Geom::BoundingBox.new
        transform = Graph.transform(path)
        8.times { |index| bounds.add(path.last.definition.bounds.corner(index).transform(transform)) }
        pieces << {'origin'=>bounds.min.to_a.map(&:to_mm), 'size'=>[bounds.width, bounds.height, bounds.depth].map(&:to_mm)}
        false
      end
      if pieces.empty?
        bounds = definition.bounds
        raise ArgumentError, 'O modelo salvo não possui geometria para inserir.' if bounds.empty?
        pieces << {'origin'=>bounds.min.to_a.map(&:to_mm), 'size'=>[bounds.width, bounds.height, bounds.depth].map(&:to_mm)}
      end
      validate_preview(pieces)
    end
    STARTERS = [
      { 'id' => 'starter:base', 'name' => 'Caixaria', 'description' => 'Um vão livre para começar.',
        'params' => Parameters::DEFAULTS.merge('name'=>'Caixaria') },
      { 'id'=>'starter:panel', 'name'=>'Painel', 'description'=>'Liso, ripado ou frisado; composição contínua, espelho e fixação.',
        'params'=>{'module_family'=>'panel','name'=>'Painel','width'=>1200,'height'=>1800,'depth'=>15,'back'=>false,'panel'=>{}} }
    ].freeze

    def self.catalog_safe_params(params)
      Finishing.sanitize_catalog_materials!(params) if defined?(Finishing)
      params
    end

    def self.user_defaults
      raw = Sketchup.read_default('rq_mydina', 'construction_defaults', nil)
      params = raw ? Parameters.normalize(JSON.parse(raw), validate_stock: false) : Parameters.normalize({'name'=>'Caixaria'}, validate_stock: false)
      Settings.apply_to_new_module(catalog_safe_params(params))
    rescue JSON::ParserError, ArgumentError
      Settings.apply_to_new_module(catalog_safe_params(Parameters.normalize({'name'=>'Caixaria'}, validate_stock: false)))
    end

    def self.save_defaults(raw)
      p = Parameters.normalize(raw)
      p.delete('assembly')
      p['module_family'] = 'cabinet'
      # Save construction and shell exceptions; internal layouts/fronts remain library templates.
      p['opening_layouts'] = []
      p['layout'], p['fronts'], p['name'] = { 'id' => 'root' }, [], 'Caixaria'
      p['piece_settings'] = p['piece_settings'].select { |role, _| %w[left right bottom top back rail:front rail:back bottom:front bottom:back back:top back:bottom].include?(role) }
      p = catalog_safe_params(Parameters.normalize(p))
      Sketchup.write_default('rq_mydina', 'construction_defaults', JSON.generate(p))
      p
    end

    def self.directory
      @directory_override || File.join(ENV.fetch('LOCALAPPDATA', Dir.home), 'Plany', 'Biblioteca')
    end

    def self.starters
      defaults = user_defaults
      STARTERS.map do |entry|
        params = if entry['params']['module_family']=='panel'
          Parameters.normalize(defaults.merge(entry['params']).merge('layout'=>{'id'=>'root'}, 'fronts'=>[], 'claddings'=>[], 'trims'=>[], 'opening_layouts'=>[], 'piece_settings'=>{}, 'excluded_pieces'=>[]))
        else
          defaults.merge('name'=>entry['params']['name'],'layout'=>entry['params']['layout'])
        end
        entry.merge('params'=>params)
      end
    end

    def self.list
      saved, invalid = [], 0
      if Dir.exist?(directory)
        Dir.children(directory).select { |name| name.end_with?('.json') }.each do |name|
          path = File.join(directory, name)
          begin
            entry = JSON.parse(File.read(path, encoding: 'UTF-8'))
            validate_entry(entry)
            raise ArgumentError unless File.basename(path, '.json') == entry['id']
            raise ArgumentError unless File.file?(File.join(directory, "#{entry['id']}.skp"))
            saved << entry
          rescue JSON::ParserError, ArgumentError, TypeError, KeyError
            invalid += 1
          end
        end
      end
      { 'starters' => starters, 'saved' => saved.sort_by { |e| e['created_at'].to_s }.reverse,
        'piece_starters' => piece_starters, 'saved_pieces' => saved_pieces,
        'directory' => directory, 'invalid' => invalid }
    end

    def self.piece_starters
      t = user_defaults['thickness']
      [['shelf','Prateleira',[600,450,t],2], ['side','Tamponamento lateral',[t,450,720],0],
       ['rail','Régua',[600,t,70],1]].map do |id,name,size,axis|
        {'id'=>'piece:'+id, 'name'=>name, 'size'=>size, 'axis'=>axis,
         'settings'=>Parameters.normalize_piece({}), 'material'=>user_defaults['material'], 'scale'=>[1,1,1]}
      end + [glass_starter, baseboard_starter] + %w[crown cladding door drawer].map { |kind| functional_starter(kind) }
    end

    def self.glass_starter
      data = Parameters.normalize_piece('construction_type'=>'glass', 'glass_model'=>'liso', 'glass_color'=>'clear', 'thickness'=>6)
      {'id'=>'piece:glass', 'name'=>'Vidro', 'size'=>[600,6,400], 'axis'=>1,
       'settings'=>data, 'material'=>data['material'], 'scale'=>[1,1,1]}
    end

    def self.baseboard_starter
      defaults = user_defaults
      params = Parameters.normalize(defaults.merge('name' => 'Rodapé avulso', 'module_family' => 'baseboard',
        'height' => 100, 'layout' => {'id' => 'root'}, 'opening_layouts' => [], 'fronts' => [], 'claddings' => [], 'piece_settings' => {}, 'accessories' => [],
        'trims' => [{'kind' => 'baseboard', 'structure_version' => 1, 'height' => 100, 'foot_height' => 15,
          'thickness' => defaults['thickness'], 'material' => defaults['apparent_material'].to_s.empty? ? defaults['material'] : defaults['apparent_material'],
          'frame_material' => defaults['hidden_material'], 'max_opening' => 600}]), validate_stock: false)
      {'id' => 'piece:baseboard', 'kind' => 'baseboard', 'name' => 'Rodapé avulso',
        'size' => params.values_at('width', 'depth', 'height'), 'params' => params}
    end

    def self.functional_starter(kind)
      p = user_defaults.merge('module_family'=>'functional', 'component_kind'=>kind, 'back'=>false,
        'layout'=>{'id'=>'root'}, 'opening_layouts'=>[], 'piece_settings'=>{}, 'fronts'=>[], 'trims'=>[], 'claddings'=>[], 'accessories'=>[])
      p['height'] = 100 if kind == 'crown'
      p['trims'] = [{'kind'=>'crown', 'height'=>100}] if kind == 'crown'
      p['claddings'] = [{'side'=>'left', 'front'=>0}] if kind == 'cladding'
      p['fronts'] = [{'id'=>'loose', 'kind'=>'door', 'nodes'=>['root'], 'fit'=>'inset', 'count'=>2, 'door_opening'=>'double'}] if kind == 'door'
      if kind=='drawer'
        p.merge!('width'=>500,'height'=>150,'depth'=>400)
        p['fronts']=[{'id'=>'loose','kind'=>'drawers','nodes'=>['root'],'hardware_layout_version'=>1}]
      end
      p['name'] = {'crown'=>'Rodateto avulso', 'cladding'=>'Tamponamento avulso', 'door'=>'Portas avulsas','drawer'=>'Gaveta avulsa'}.fetch(kind)
      p = Parameters.normalize(p, validate_stock: false)
      {'id'=>"piece:#{kind}", 'kind'=>kind, 'name'=>p['name'], 'params'=>p, 'size'=>p.values_at('width','depth','height')}
    end

    def self.validate_piece(entry)
      raise ArgumentError, 'Peça da biblioteca inválida.' unless entry.is_a?(Hash) && entry['size'].is_a?(Array) && entry['size'].length == 3 && [0,1,2].include?(entry['axis'])
      entry['size'] = entry['size'].map { |v| Parameters.number(v, 'Medida da peça', 0.1, 6000) }
      entry['settings'] = Parameters.normalize_piece(entry['settings'] || {})
      if defined?(Finishing)
        Finishing.sanitize_catalog_materials!(entry['settings'])
        family = entry['settings'].fetch('construction_type', 'mdf')
        if family == 'mdf' && (!defined?(MaterialCatalog) || !MaterialCatalog.valid_mdf_name?(entry['material']))
          entry['material'] = 'Branco TX'
        end
      end
      entry['material'] = Parameters.material_name(entry['material'], 'Branco TX')
      scale = entry['scale'] || [1,1,1]
      raise ArgumentError, 'Escala da peça inválida.' unless scale.is_a?(Array) && scale.length == 3 && scale.all? { |v| v.is_a?(Numeric) && v.finite? && v > 0 }
      entry['scale'] = scale
      entry
    end

    def self.saved_pieces
      folder = File.join(directory, 'Pecas')
      Dir.glob('*.json', base: folder.tr('\\', '/')).filter_map do |relative|
        file = File.join(folder, relative)
        begin
          item = validate_piece(JSON.parse(File.read(file, encoding:'UTF-8')))
          next unless item['id'].to_s.match?(/\A[0-9a-f-]{36}\z/) && File.basename(file,'.json') == item['id'] && File.file?(file.sub(/\.json\z/,'.skp'))
          item
        rescue JSON::ParserError, ArgumentError, TypeError
          nil
        end
      end
    end

    def self.save_piece(path)
      Geometry.authorize_operation!
      part = path.last
      raise ArgumentError, 'Selecione uma única peça Plany.' unless Graph.registered?(part)
      bounds = Appearance.box!(part); transform = Graph.transform(path); Graph.unit(transform)
      scale = Graph.scales(transform)
      id = SecureRandom.uuid
      entry = {'id'=>id, 'name'=>part.name.empty? ? 'Minha peça' : part.name,
        'size'=>Geometry.physical_size(part, transform),
        'axis'=>Finishing.axis(part), 'scale'=>scale, 'settings'=>Geometry.piece_data(part),
        'material'=>part.get_attribute(Geometry::DICTIONARY,'cut_material','Branco TX')}
      validate_piece(entry)
      folder = File.join(directory,'Pecas'); FileUtils.mkdir_p(folder)
      file = File.join(folder,id+'.skp')
      staging = File.join(folder,id+'.staging.skp')
      begin
        export_definition(part.definition, staging)
        validate_piece(JSON.parse(JSON.generate(entry)))
        File.rename(staging, file)
        temporary = File.join(folder,id+'.json.tmp')
        File.write(temporary,JSON.pretty_generate(entry),encoding:'UTF-8')
        validate_piece(JSON.parse(File.read(temporary,encoding:'UTF-8')))
        File.rename(temporary,File.join(folder,id+'.json'))
      rescue StandardError
        [file,staging,temporary].compact.each { |path| File.delete(path) if File.file?(path) }
        raise
      end
      entry
    end

    def self.piece_source(model,id, deferred: false)
      entry = piece_starters.find { |e| e['id']==id }
      return [entry,nil] if entry
      entry = saved_pieces.find { |e| e['id']==id }
      raise ArgumentError, 'Peça não encontrada na biblioteca.' unless entry
      if deferred
        return [entry, saved_source(File.join(directory,'Pecas',id+'.skp'), nil), nil]
      end
      definition, temporary = load_definition(model, File.join(directory,'Pecas',id+'.skp'))
      [entry, definition, temporary]
    end

    def self.insert_piece(model,entry,definition,transform)
      Geometry.ensure_root!(model)
      data = PieceOrientation.validate!(entry['size'], entry['axis'], entry['settings'], entry['material'], entry['name'])
      validate_source_file!(definition)
      Geometry.transaction(model,'Plany: inserir peça da biblioteca') do
        owner = nil
        if deferred_source?(definition)
          definition, owner = load_definition(model, definition.path)
        end
        begin
        if definition
          part = model.entities.add_instance(definition,transform*Geom::Transformation.scaling(*entry['scale']))
          part.make_unique
          # Center the saved definition at its own minimum corner before placement.
          b = part.definition.bounds
          part.definition.entities.transform_entities(Geom::Transformation.translation(ORIGIN-b.min),part.definition.entities.to_a)
          bounds=part.definition.bounds
          exact=[bounds.width,bounds.height,bounds.depth]
          local=entry['size'].zip(entry['scale']).map { |mm,scale| mm/scale }
          part.definition.entities.transform_entities(Geom::Transformation.scaling(bounds.min,*Geometry.dimension_factors(local,exact)),part.definition.entities.to_a)
          part.definition.invalidate_bounds
        else
          part = model.entities.add_group
          dx,dy,dz=entry['size'].map(&:mm)
          face=part.entities.add_face([0,0,0],[dx,0,0],[dx,dy,0],[0,dy,0]);face.reverse! if face.normal.z<0;face.pushpull(dz)
          part.transformation=transform
        end
        part.set_attribute(Geometry::DICTIONARY,'piece_data',JSON.generate(data))
        # Register the technical sheet, cut label and visible finish from the
        # library entry together. Faces alone cannot identify the MDF stock.
        part=Appearance.register(part, source_material: entry['material'])
        part.name=entry['name']
        Geometry.select(model,part)
        part
        ensure
          release_unused_definition(model, definition, owner) if owner
        end
      end
    end

    def self.validate_entry(entry)
      unless entry.is_a?(Hash) && entry['schema'] == 1 && entry['id'].is_a?(String) &&
             entry['id'].match?(/\A[0-9a-f-]{36}\z/) && entry['name'].is_a?(String)
        raise ArgumentError, 'Este item da biblioteca é inválido.'
      end
      entry['params'] = catalog_safe_params(Parameters.from_saved(entry['params']))
      entry['module_family'] = entry['params']['module_family']
      validate_identity(entry['identity']) if entry.key?('identity')
      validate_preview(entry['preview']) if entry.key?('preview')
      if entry.key?('behavior')
        raise ArgumentError, 'Comportamento do modelo inválido.' unless entry['behavior'].is_a?(Array)
        entry['behavior'].each do |part|
          raise ArgumentError, 'Comportamento do modelo inválido.' unless part.is_a?(Hash) && part['signature'].is_a?(String) && part['name'].is_a?(String)
          part['rule'] = Rules.normalize(part['rule'])
        end
      end
      entry
    end

    # A definition SKP contains its children, not the attributes of its root
    # occurrence. Keep explicit identity separate from construction recipes.
    # Legacy entries without this field are not migrated or guessed on read.
    def self.validate_identity(identity)
      unless identity.is_a?(Hash) && identity.keys.sort == %w[aggregate version] &&
             identity['version'] == 1 && [nil, false, true].include?(identity['aggregate'])
        raise ArgumentError, 'Identidade do modelo salvo inválida.'
      end
      identity
    end

    def self.behavior_parts(definition)
      Graph.boards(definition.entities).reject { |path| path.last.get_attribute(Geometry::DICTIONARY, 'role') }
    end

    def self.behavior_signature(path)
      part = path.last
      origin = Graph.transform(path).origin.to_a.map { |v| (v.to_mm * 10).round / 10.0 }
      bounds = part.definition.bounds
      size = [bounds.width, bounds.height, bounds.depth].map { |v| (v.to_mm * 10).round / 10.0 }
      JSON.generate([part.name, origin, size])
    end

    def self.behavior_from_definition(definition)
      behavior_parts(definition).map do |path|
        part = path.last
        { 'signature' => behavior_signature(path), 'name' => part.name.empty? ? 'Peça sem nome' : part.name,
          'rule' => Rules.normalize(JSON.parse(part.get_attribute(Geometry::DICTIONARY, 'rule', '{}'))) }
      end
    end

    def self.match_behavior!(definition, behavior)
      parts = behavior_parts(definition)
      unless parts.length == behavior.length && parts.zip(behavior).all? { |path, item| behavior_signature(path) == item['signature'] }
        raise ArgumentError, 'As peças do modelo salvo mudaram. A configuração não foi aplicada por segurança.'
      end
      parts
    end

    def self.apply_behavior(definition, behavior)
      return unless behavior
      match_behavior!(definition, behavior).zip(behavior).each do |path, item|
        rule = Rules.normalize(item['rule'])
        Workshop.validate_rule(path.last, rule, Graph.transform(path))
        path.last.set_attribute(Geometry::DICTIONARY, 'rule', JSON.generate(rule))
      end
    end

    def self.model_behavior(model, id)
      entry = saved_model_entry(id)
      behavior = entry['behavior']
      unless behavior
        behavior = with_temporary_definition(model, File.join(directory, "#{id}.skp")) { |definition| behavior_from_definition(definition) }
      end
      { 'id' => id, 'name' => entry['name'], 'parts' => behavior }
    end

    def self.load_definition(model, path)
      existing = model.definitions.to_a
      materials = model.materials.to_a
      definition = model.definitions.load(path)
      raise IOError, 'Não foi possível abrir o modelo salvo.' unless definition
      [definition, existing.include?(definition) ? nil : { :definitions => existing, :materials => materials }]
    end

    def self.release_unused_definition(model, definition, temporary)
      return unless temporary && definition && definition.valid? && definition.instances.empty?
      new_definitions = model.definitions.to_a - temporary[:definitions]
      new_definitions.reverse_each do |item|
        model.definitions.remove(item) if item.valid? && item.instances.empty?
      end
      new_materials = model.materials.to_a - temporary[:materials]
      new_materials.each do |material|
        next unless material.valid?
        next if model.materials.current == material
        used = ([model.entities] + model.definitions.to_a.map(&:entities)).any? do |entities|
          entities.any? { |item| item.respond_to?(:material) && item.material == material || item.respond_to?(:back_material) && item.back_material == material }
        end
        model.materials.remove(material) unless used
      end
    end

    def self.with_temporary_definition(model, path)
      definition, temporary = load_definition(model, path)
      yield definition
    ensure
      release_unused_definition(model, definition, temporary) if definition
    end

    def self.write_json(path, entry)
      validate_entry(JSON.parse(JSON.generate(entry)))
      temporary = path + ".#{SecureRandom.uuid}.tmp"
      begin
        File.write(temporary, JSON.pretty_generate(entry), encoding: 'UTF-8')
        validate_entry(JSON.parse(File.read(temporary, encoding: 'UTF-8')))
        File.rename(temporary, path)
      ensure
        File.delete(temporary) if File.file?(temporary)
      end
    end

    # SU 2021's definition.save_as can return true without writing, and changes
    # the live definition's path/GUID. Never manufacture temporary definitions
    # in the live model: even an aborted operation discards a pending Redo.
    # The standalone SDK operates exclusively on a fresh Model#save_copy file.
    module LegacyExport
      def self.unavailable_message
        'O exportador do SketchUp está indisponível. Salve seu projeto, feche o SketchUp e use a opção Reparar no instalador oficial do SketchUp. Reabra o programa e tente novamente. O componente acompanha o SketchUp; seus itens já salvos na Biblioteca foram preservados.'
      end

      def self.function(name, arguments, result = Fiddle::TYPE_INT)
        @functions ||= {}
        @functions[name] ||= Fiddle::Function.new(@api[name], arguments, result)
      end

      def self.check(name, arguments, *values)
        code = function(name, arguments).call(*values)
        raise IOError, "Não foi possível exportar o modelo (#{name}: #{code})." unless code == 0
      end

      def self.open(path)
        begin
          require 'fiddle'
        rescue LoadError => error
          warn "[Plany] Componente de exportação indisponível: #{error.message}"
          raise IOError, unavailable_message
        end
        raise IOError, 'A exportação deve ocorrer na sessão principal do SketchUp.' unless Thread.current == Thread.main
        location = Sketchup.find_support_file('SketchUpAPI.dll')
        raise IOError, unavailable_message unless location && File.file?(location)
        @api ||= Fiddle.dlopen(location)
        native = Fiddle::Pointer["\0" * Fiddle::SIZEOF_VOIDP]
        function('SUInitialize', [], Fiddle::TYPE_VOID).call
        begin
          check('SUModelCreateFromFile', [Fiddle::TYPE_VOIDP, Fiddle::TYPE_VOIDP], native, path.encode('UTF-8'))
          yield native[0, Fiddle::SIZEOF_VOIDP].unpack1('J')
        ensure
          function('SUModelRelease', [Fiddle::TYPE_VOIDP]).call(native) unless native[0, Fiddle::SIZEOF_VOIDP].unpack1('J') == 0
          function('SUTerminate', [], Fiddle::TYPE_VOID).call
        end
      rescue StandardError => error
        raise unless defined?(Fiddle::DLError) && error.is_a?(Fiddle::DLError)
        warn "[Plany] Componente de exportação indisponível: #{error.message}"
        raise IOError, unavailable_message
      end

      def self.preview(path)
        open(path) do |model|
          pointer = Fiddle::TYPE_VOIDP
          entities = Fiddle::Pointer["\0" * Fiddle::SIZEOF_VOIDP]
          box = Fiddle::Pointer["\0" * 48]
          check('SUModelGetEntities', [pointer, pointer], model, entities)
          check('SUEntitiesGetBoundingBox', [pointer, pointer], entities[0, Fiddle::SIZEOF_VOIDP].unpack1('J'), box)
          values = box[0, 48].unpack('d*')
          [{'origin'=>values.first(3).map(&:to_mm), 'size'=>3.times.map { |axis| (values[axis + 3] - values[axis]).to_mm }}]
        end
      end

      def self.save(definition, path)
        model = definition.model
        occurrence = definition.instances.find { |item| item.valid? }
        raise IOError, 'O modelo não possui uma ocorrência válida para exportar.' unless occurrence
        snapshot = path + ".#{SecureRandom.uuid}.snapshot.skp"
        begin
          unless model.save_copy(snapshot) && File.size?(snapshot)
            raise IOError, 'O SketchUp não gerou a cópia atual do modelo. Nenhum item foi substituído.'
          end
          open(snapshot) do |native|
            pointer = Fiddle::TYPE_VOIDP
            width = Fiddle::SIZEOF_VOIDP
            entity = Fiddle::Pointer["\0" * width]
            pid = [occurrence.persistent_id].pack('q<')
            check('SUModelGetEntitiesByPersistentIDs', [pointer, Fiddle::TYPE_SIZE_T, pointer, pointer],
                  native, 1, pid, entity)
            instance = function('SUComponentInstanceFromEntity', [pointer], pointer).call(entity[0, width].unpack1('J'))
            raise IOError, 'A ocorrência não foi encontrada na cópia do modelo.' if instance.to_i == 0
            # Export definition-local geometry, independently of which source
            # occurrence was translated, rotated or scaled in the live model.
            identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].pack('d*')
            check('SUComponentInstanceSetTransform', [pointer, pointer], instance, identity)
            check('SUComponentInstanceSaveAs', [pointer, pointer], instance, path.encode('UTF-8'))
          end
        ensure
          File.delete(snapshot) if snapshot && File.file?(snapshot)
        end
      end
    end

    def self.export_definition(definition, path)
      Geometry.authorize_operation!
      raise IOError, 'O destino de exportação já existe; nenhum arquivo foi substituído.' if File.exist?(path)
      result = if definition.respond_to?(:save_copy)
        definition.save_copy(path)
      elsif Sketchup.platform == :platform_win
        LegacyExport.save(definition, path)
        true
      else
        definition.save_as(path)
      end
      unless result && File.file?(path) && File.size(path) > 0
        raise IOError, 'O SketchUp não gerou o arquivo do modelo. O item anterior da biblioteca foi preservado.'
      end
      path
    end

    def self.save_behavior(model, id, raw)
      entry = saved_model_entry(id)
      raise ArgumentError, 'Comportamento do modelo inválido.' unless raw.is_a?(Array)
      behavior = with_temporary_definition(model, File.join(directory, "#{id}.skp")) do |definition|
        match_behavior!(definition, raw).zip(raw).map do |path, item|
          rule = Rules.normalize(item['rule'])
          Workshop.validate_rule(path.last, rule, Graph.transform(path))
          { 'signature' => item['signature'], 'name' => path.last.name.empty? ? 'Peça sem nome' : path.last.name, 'rule' => rule }
        end
      end
      entry['behavior'] = behavior
      write_json(File.join(directory, "#{id}.json"), entry)
      entry
    end

    def self.saved_model_entry(id)
      raise ArgumentError, 'O item da biblioteca não foi encontrado.' unless id.is_a?(String) && id.match?(/\A[0-9a-f-]{36}\z/)
      entry = validate_entry(JSON.parse(File.read(File.join(directory, "#{id}.json"), encoding: 'UTF-8')))
      raise ArgumentError, 'A identificação do item é inválida.' unless entry['id'] == id && File.file?(File.join(directory, "#{id}.skp"))
      entry
    rescue Errno::ENOENT, JSON::ParserError
      raise ArgumentError, 'O item está incompleto. Confira os arquivos da biblioteca.'
    end

    def self.rename_model(id, name)
      entry = saved_model_entry(id)
      name = name.to_s.strip
      raise ArgumentError, 'Informe um nome para o modelo.' if name.empty?
      raise ArgumentError, 'Use até 60 caracteres no nome do modelo.' if name.length > 60
      entry['name'] = name
      entry['params']['name'] = name
      write_json(File.join(directory, "#{id}.json"), entry)
      entry
    end

    def self.delete_model(id)
      saved_model_entry(id)
      cleanup_trash
      token = SecureRandom.uuid
      trash = File.join(directory, 'Lixeira', token)
      FileUtils.mkdir_p(trash)
      moved = []
      begin
        %w[skp json].each do |extension|
          original = File.join(directory, "#{id}.#{extension}")
          deleted = File.join(trash, "#{id}.#{extension}")
          File.rename(original, deleted)
          moved << [original, deleted]
        end
      rescue StandardError
        moved.reverse_each { |original, deleted| File.rename(deleted, original) if File.file?(deleted) }
        Dir.rmdir(trash) if Dir.exist?(trash) && Dir.empty?(trash)
        raise
      end
      token
    end

    def self.restore_model(token)
      raise ArgumentError, 'Exclusão não encontrada.' unless token.to_s.match?(/\A[0-9a-f-]{36}\z/)
      trash = File.join(directory, 'Lixeira', token)
      files = Dir.exist?(trash) ? Dir.children(trash).select { |name| name.end_with?('.json') }.map { |name| File.join(trash, name) } : []
      raise ArgumentError, 'Exclusão não encontrada.' unless files.length == 1
      entry = validate_entry(JSON.parse(File.read(files.first, encoding: 'UTF-8')))
      id = entry['id']
      raise ArgumentError, 'Exclusão incompleta.' unless File.basename(files.first, '.json') == id && File.file?(File.join(trash, "#{id}.skp"))
      raise ArgumentError, 'Já existe um modelo com este identificador.' if %w[skp json].any? { |ext| File.exist?(File.join(directory, "#{id}.#{ext}")) }
      moved = []
      begin
        %w[skp json].each do |ext|
          from = File.join(trash, "#{id}.#{ext}")
          to = File.join(directory, "#{id}.#{ext}")
          File.rename(from, to)
          moved << [from, to]
        end
      rescue StandardError
        moved.reverse_each { |from, to| File.rename(to, from) if File.file?(to) }
        raise
      end
      Dir.rmdir(trash)
      entry
    end

    def self.cleanup_trash
      root = File.join(directory, 'Lixeira')
      return unless Dir.exist?(root)
      Dir.children(root).each do |name|
        next unless name.match?(/\A[0-9a-f-]{36}\z/)
        folder = File.join(root, name)
        next unless File.directory?(folder) && Time.now - File.mtime(folder) > 86_400
        files = Dir.children(folder)
        next unless files.length == 2 && files.map { |f| File.extname(f) }.sort == %w[.json .skp]
        FileUtils.remove_entry(folder)
      end
    end

    def self.save(model, instance, name)
      Geometry.authorize_operation!
      Geometry.validate_instance!(model, instance)
      params = Geometry.read(instance).merge('name' => name.to_s.strip)
      params = catalog_safe_params(Parameters.normalize(params))
      id = SecureRandom.uuid
      entry = { 'schema' => 1, 'id' => id, 'name' => params['name'], 'params' => params,
                'module_family' => params['module_family'],
                'identity' => {'version'=>1, 'aggregate'=>instance.get_attribute(Geometry::DICTIONARY, 'aggregate')},
                'preview' => preview_from_definition(instance.definition),
                'extras' => Geometry.extras(instance).length, 'behavior' => behavior_from_definition(instance.definition),
                'created_at' => Time.now.utc.strftime('%Y-%m-%dT%H:%M:%SZ') }
      FileUtils.mkdir_p(directory)
      path = File.join(directory, "#{id}.skp")
      staging = File.join(directory, "#{id}.staging.skp")
      begin
        # Store the geometry itself, including arbitrary additions and materials.
        validate_entry(JSON.parse(JSON.generate(entry)))
        export_definition(instance.definition, staging)
        File.rename(staging, path)
        write_json(File.join(directory, "#{id}.json"), entry)
      rescue StandardError
        File.delete(path) if File.file?(path)
        File.delete(staging) if File.file?(staging)
        raise
      end
      entry
    end

    def self.source(model, id, deferred: false)
      starter = starters.find { |entry| entry['id'] == id }
      return [Parameters.normalize(starter['params']), nil] if starter
      unless id.is_a?(String) && id.match?(/\A[0-9a-f-]{36}\z/)
        raise ArgumentError, 'O item da biblioteca não foi encontrado.'
      end
      entry = saved_model_entry(id)
      path = File.join(directory, "#{id}.skp")
      if deferred && (entry['preview'] || Sketchup.platform == :platform_win)
        preview = validate_preview(entry['preview'] || LegacyExport.preview(path))
        return [entry['params'], saved_source(path, preview), entry['behavior'], nil, entry['identity']]
      end
      definition, temporary = load_definition(model, path)
      begin
        match_behavior!(definition, entry['behavior']) if entry['behavior']
      rescue StandardError
        release_unused_definition(model, definition, temporary)
        raise
      end
      [entry['params'], definition, entry['behavior'], temporary, entry['identity']]
    rescue Errno::ENOENT, JSON::ParserError
      raise ArgumentError, 'O item está incompleto. Confira os arquivos da biblioteca.'
    end
  end
end
